import { pool } from "../config/db.js"
import fs from "fs"
import path from "path"
import PDFDocument from "pdfkit"
import { HttpError } from "../utils/http.js"
import { getScopedSchoolId } from "../utils/tenantScope.js"
import { getActiveAcademicSession, requireActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { ensureFeeAccountsForActiveStudents } from "../services/financeAccountService.js"
import { getReportPdfTemplateForSchool } from "../services/reportSettingsService.js"
import { studentCodeSortSql } from "../utils/studentSort.js"

const activeInvoiceStatuses = ["unpaid", "partial", "paid"]
const paymentMethods = new Set(["cash", "bank_transfer", "mobile_money", "cheque", "pos_card", "other"])
const feeItemTypes = new Set(["tuition", "boarding", "transport", "uniform", "exam", "development", "other"])
const latePenaltyTypes = new Set(["none", "fixed", "percent"])
const discountTypes = new Set(["scholarship", "staff_child", "sibling", "hardship", "manual"])
const discountAmountTypes = new Set(["amount", "percent"])
const expenseCategories = new Set(["salaries", "utilities", "stationery", "maintenance", "transport", "food_catering", "exam_expenses", "sports_events", "other"])
const expenseStatuses = new Set(["draft", "pending_approval", "approved", "paid", "rejected"])
const financeOversightRoles = new Set(["school_owner", "headteacher", "super_admin"])
const financeSequenceSources = new Set(["finance_invoices.invoice_no", "fee_payments.receipt_no"])
const FINANCE_RECEIPT_FONT_REGULAR = "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf"
const FINANCE_RECEIPT_FONT_BOLD = "/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf"
const RIA_REFERENCE_HEADER_PATH = path.resolve(process.cwd(), "src/assets/report-templates/ria-reference-header-000.jpg")
const RIA_REFERENCE_HEADER_RATIO = 472 / 1675

function numberValue(value) {
  return Number(Number(value || 0).toFixed(2))
}

function moneyValue(value, field = "amount") {
  const amount = numberValue(value)
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, `${field} must be greater than zero`)
  return amount
}

function sameMoney(left, right) {
  return numberValue(left) === numberValue(right)
}

function cleanText(value, maxLength = 255) {
  const text = String(value ?? "").trim()
  return text ? text.slice(0, maxLength) : null
}

function cleanDate(value) {
  const text = cleanText(value, 20)
  return /^\d{4}-\d{2}-\d{2}$/.test(text || "") ? text : null
}

function dateValue(value, field = "date", options = {}) {
  const raw = cleanText(value, 20)
  if (!raw) return null
  const date = cleanDate(raw)
  if (!date) throw new HttpError(400, `${field} must be a valid YYYY-MM-DD date`)
  if (options.allowFuture === false && date > todayDate()) {
    throw new HttpError(400, `${field} cannot be in the future`)
  }
  return date
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function booleanValue(value) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true"
}

function isOversightUser(user) {
  return financeOversightRoles.has(String(user?.role || "").toLowerCase())
}

function enumValue(value, allowedValues, fallback, field) {
  const normalized = String(cleanText(value, 80) || fallback || "").toLowerCase().replace(/[\s/-]+/g, "_")
  if (!allowedValues.has(normalized)) {
    throw new HttpError(400, `${field} is not supported`)
  }
  return normalized
}

function normalizePaymentMethod(value, options = {}) {
  const method = String(value || "cash").toLowerCase().replace(/[\s/-]+/g, "_")
  if (paymentMethods.has(method)) return method
  if (options.strict) throw new HttpError(400, "payment method is not supported")
  return "other"
}

function registerFinanceReceiptFonts(doc) {
  try {
    if (fs.existsSync(FINANCE_RECEIPT_FONT_REGULAR) && fs.existsSync(FINANCE_RECEIPT_FONT_BOLD)) {
      doc.registerFont("FinanceReceipt", FINANCE_RECEIPT_FONT_REGULAR)
      doc.registerFont("FinanceReceiptBold", FINANCE_RECEIPT_FONT_BOLD)
      return { regular: "FinanceReceipt", bold: "FinanceReceiptBold" }
    }
  } catch {
    // Built-in fonts are the safe PDFKit fallback.
  }
  return { regular: "Helvetica", bold: "Helvetica-Bold" }
}

function receiptText(value, fallback = "-") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  return text || fallback
}

function receiptMoney(value) {
  return `MWK ${Number(value || 0).toLocaleString("en-MW", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function receiptDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" })
}

function safeReceiptFilename(value) {
  return String(value || "receipt").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "receipt"
}

function drawReceiptHeader(doc, receipt, fonts, templateId) {
  const pageWidth = doc.page.width
  const margin = 42
  if (templateId === "ria_exact" && fs.existsSync(RIA_REFERENCE_HEADER_PATH)) {
    const imageHeight = pageWidth * RIA_REFERENCE_HEADER_RATIO
    doc.image(RIA_REFERENCE_HEADER_PATH, 0, 0, { width: pageWidth })
    doc.font(fonts.bold).fontSize(11).fillColor("#052a63")
      .text("OFFICIAL FEE RECEIPT", margin, imageHeight + 7, { width: pageWidth - (margin * 2), align: "center" })
    return imageHeight + 38
  }

  doc.rect(0, 0, pageWidth, 96).fill("#f8fafc")
  doc.rect(0, 0, 18, 126).fill("#111827")
  doc.rect(18, 0, 4, 126).fill("#14b8a6")
  doc.font(fonts.bold).fontSize(15).fillColor("#111827")
    .text(receiptText(receipt.school_name, "SmartLink School").toUpperCase(), margin, 30, { width: 340 })
  doc.font(fonts.regular).fontSize(8.6).fillColor("#64748b")
    .text([receipt.school_city, receipt.school_country].filter(Boolean).join(", "), margin, 51, { width: 320 })
  doc.font(fonts.bold).fontSize(12).fillColor("#111827")
    .text("OFFICIAL FEE RECEIPT", margin, 108, { width: pageWidth - (margin * 2), align: "center" })
  return 138
}

function drawReceiptRow(doc, fonts, label, value, x, y, width) {
  doc.font(fonts.bold).fontSize(8.8).fillColor("#475569").text(label.toUpperCase(), x, y, { width })
  doc.font(fonts.regular).fontSize(10).fillColor("#111827").text(receiptText(value), x, y + 13, { width })
}

function drawReceiptPdf(receipt, res, templateId) {
  const doc = new PDFDocument({ size: "LETTER", margin: 42 })
  const fonts = registerFinanceReceiptFonts(doc)
  const filename = `${safeReceiptFilename(receipt.receipt_no)}.pdf`
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`)
  doc.pipe(res)

  let y = drawReceiptHeader(doc, receipt, fonts, templateId)
  const margin = 42
  const width = doc.page.width - (margin * 2)

  doc.roundedRect(margin, y, width, 58, 6).fillAndStroke("#f8fafc", "#dce3ed")
  doc.font(fonts.bold).fontSize(8.8).fillColor("#64748b").text("RECEIPT NUMBER", margin + 18, y + 14, { width: 150 })
  doc.font(fonts.bold).fontSize(17).fillColor("#111827").text(receiptText(receipt.receipt_no), margin + 18, y + 28, { width: 220 })
  doc.font(fonts.bold).fontSize(8.8).fillColor("#64748b").text("AMOUNT RECEIVED", margin + 330, y + 14, { width: 150, align: "right" })
  doc.font(fonts.bold).fontSize(18).fillColor("#0f766e").text(receiptMoney(receipt.amount), margin + 300, y + 28, { width: width - 318, align: "right" })
  y += 82

  doc.roundedRect(margin, y, width, 116, 6).strokeColor("#dce3ed").lineWidth(0.8).stroke()
  drawReceiptRow(doc, fonts, "Student", [receipt.first_name, receipt.last_name].filter(Boolean).join(" "), margin + 18, y + 18, 210)
  drawReceiptRow(doc, fonts, "Admission No.", receipt.admission_no || receipt.student_code, margin + 260, y + 18, 120)
  drawReceiptRow(doc, fonts, "Class", receipt.class_name, margin + 410, y + 18, 120)
  drawReceiptRow(doc, fonts, "Term", receipt.term_name, margin + 18, y + 70, 210)
  drawReceiptRow(doc, fonts, "Payment Method", String(receipt.payment_method || "cash").replace(/_/g, " "), margin + 260, y + 70, 120)
  drawReceiptRow(doc, fonts, "Payment Date", receiptDate(receipt.paid_on || receipt.paid_at), margin + 410, y + 70, 120)
  y += 142

  doc.font(fonts.bold).fontSize(10).fillColor("#111827").text("Payment Summary", margin, y)
  y += 20
  const columns = [230, 100, 100, 100]
  const labels = ["Description", "Before", "Paid", "After"]
  let cursor = margin
  doc.rect(margin, y, width, 26).fill("#111827")
  labels.forEach((label, index) => {
    doc.font(fonts.bold).fontSize(8.5).fillColor("#ffffff").text(label, cursor + 8, y + 8, { width: columns[index] - 16, align: index ? "right" : "left" })
    cursor += columns[index]
  })
  y += 26
  cursor = margin
  doc.rect(margin, y, width, 34).fillAndStroke("#ffffff", "#dce3ed")
  const values = [
    `Fee payment${receipt.reference ? ` (${receipt.reference})` : ""}`,
    receiptMoney(receipt.balance_before),
    receiptMoney(receipt.amount),
    receiptMoney(receipt.balance_after),
  ]
  values.forEach((value, index) => {
    doc.font(index === 2 ? fonts.bold : fonts.regular).fontSize(9.2).fillColor(index === 2 ? "#0f766e" : "#111827")
      .text(value, cursor + 8, y + 11, { width: columns[index] - 16, align: index ? "right" : "left" })
    cursor += columns[index]
  })
  y += 58

  doc.roundedRect(margin, y, width, 52, 6).fillAndStroke("#f8fafc", "#dce3ed")
  doc.font(fonts.bold).fontSize(8.8).fillColor("#64748b").text("RECORDED BY", margin + 16, y + 13, { width: 160 })
  doc.font(fonts.regular).fontSize(10).fillColor("#111827").text(receiptText(receipt.recorded_by_name), margin + 16, y + 28, { width: 220 })
  doc.font(fonts.bold).fontSize(8.8).fillColor("#64748b").text("STATUS", margin + 355, y + 13, { width: 110, align: "right" })
  doc.font(fonts.bold).fontSize(10).fillColor(receipt.status === "posted" ? "#0f766e" : "#b91c1c").text(receiptText(receipt.status).toUpperCase(), margin + 355, y + 28, { width: width - 371, align: "right" })

  doc.font(fonts.regular).fontSize(8.2).fillColor("#64748b")
    .text("This receipt was generated by SmartLink Schools finance records. Keep it for school and guardian reference.", margin, doc.page.height - 78, { width, align: "center" })
  doc.moveTo(margin, doc.page.height - 54).lineTo(margin + width, doc.page.height - 54).strokeColor("#dce3ed").lineWidth(0.6).stroke()
  doc.font(fonts.bold).fontSize(8).fillColor("#111827")
    .text("SmartLink Schools", margin, doc.page.height - 42, { width: width / 2 })
    .text("Official Fee Receipt", margin + width / 2, doc.page.height - 42, { width: width / 2, align: "right" })
  doc.end()
}

function termNameFromSession(session) {
  return [session.term?.name, session.academicYear?.name].filter(Boolean).join(" ") || "Current Term"
}

function accountBalance(account) {
  return numberValue(Number(account.amount_due || 0) + Number(account.penalty_amount || 0) - Number(account.discount_amount || 0) - Number(account.amount_paid || 0))
}

function accountStatus(account) {
  const balance = accountBalance(account)
  if (balance <= 0) return "paid"
  if (account.due_date && String(account.due_date).slice(0, 10) < todayDate()) return "overdue"
  return Number(account.amount_paid || 0) > 0 ? "partial" : "unpaid"
}

function invoiceStatus(total, paid, currentStatus = "unpaid") {
  if (["cancelled", "reversed"].includes(currentStatus)) return currentStatus
  if (Number(paid || 0) <= 0) return "unpaid"
  if (Number(paid || 0) >= Number(total || 0)) return "paid"
  return "partial"
}

async function auditFinance(connection, req, action, entityType, entityId, oldValue = null, newValue = null) {
  const schoolId = getScopedSchoolId(req)
  await connection.query(
    `INSERT INTO finance_audit_logs (
       school_id, user_id, user_role, action, entity_type, entity_id,
       old_value_json, new_value_json, ip_address, user_agent
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      req.user?.id || null,
      req.user?.role || null,
      action,
      entityType,
      entityId || null,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      req.ip || null,
      cleanText(req.get?.("user-agent"), 255),
    ],
  )
}

async function updateAccountTotals(connection, schoolId, feeAccountId) {
  const [[account]] = await connection.query(
    "SELECT * FROM fee_accounts WHERE school_id = ? AND id = ? FOR UPDATE",
    [schoolId, feeAccountId],
  )
  if (!account) throw new HttpError(404, "Fee account not found")

  const [[paymentTotals]] = await connection.query(
    "SELECT COALESCE(SUM(amount), 0) AS paid FROM fee_payments WHERE school_id = ? AND fee_account_id = ? AND status = 'posted'",
    [schoolId, feeAccountId],
  )
  const amountPaid = numberValue(paymentTotals?.paid || 0)
  const nextAccount = { ...account, amount_paid: amountPaid }
  const status = accountStatus(nextAccount)

  await connection.query(
    "UPDATE fee_accounts SET amount_paid = ?, status = ? WHERE school_id = ? AND id = ?",
    [amountPaid, status, schoolId, feeAccountId],
  )
  await connection.query(
    `UPDATE finance_invoices
     SET amount_paid = ?,
       status = CASE
         WHEN status IN ('cancelled', 'reversed') THEN status
         WHEN ? >= total_amount THEN 'paid'
         WHEN ? > 0 THEN 'partial'
         ELSE 'unpaid'
       END
     WHERE school_id = ? AND fee_account_id = ? AND status IN ('unpaid', 'partial', 'paid')`,
    [amountPaid, amountPaid, amountPaid, schoolId, feeAccountId],
  )

  return { ...nextAccount, status, balance: accountBalance(nextAccount) }
}

function discountAppliedAmount(discount, account, invoice) {
  const outstanding = invoice
    ? numberValue(Number(invoice.total_amount || 0) - Number(invoice.amount_paid || 0))
    : accountBalance(account)
  if (outstanding <= 0) throw new HttpError(400, "Discount cannot be applied because the selected balance is already settled")
  const amount = discount.amount_type === "percent"
    ? numberValue((outstanding * Number(discount.amount_value || 0)) / 100)
    : numberValue(discount.amount_value)
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Discount value must be greater than zero")
  if (amount > outstanding) throw new HttpError(400, "Discount cannot exceed the outstanding balance")
  return amount
}

async function resolveDiscountTarget(connection, schoolId, discount) {
  let invoice = null
  let account = null
  if (discount.invoice_id) {
    const [[invoiceRow]] = await connection.query(
      `SELECT i.*, f.id AS resolved_fee_account_id, f.student_id AS resolved_student_id
       FROM finance_invoices i
       JOIN fee_accounts f ON f.id = i.fee_account_id AND f.school_id = i.school_id
       WHERE i.school_id = ? AND i.id = ?
       LIMIT 1 FOR UPDATE`,
      [schoolId, discount.invoice_id],
    )
    if (!invoiceRow) throw new HttpError(404, "Discount invoice was not found")
    invoice = invoiceRow
    discount.fee_account_id = Number(invoiceRow.resolved_fee_account_id)
  }
  if (discount.fee_account_id) {
    const [[accountRow]] = await connection.query("SELECT * FROM fee_accounts WHERE school_id = ? AND id = ? FOR UPDATE", [schoolId, discount.fee_account_id])
    if (!accountRow) throw new HttpError(404, "Discount fee account was not found")
    account = accountRow
  } else {
    const [[accountRow]] = await connection.query(
      `SELECT * FROM fee_accounts
       WHERE school_id = ? AND student_id = ? AND amount_due + penalty_amount - discount_amount - amount_paid > 0
       ORDER BY due_date IS NULL, due_date, id DESC LIMIT 1 FOR UPDATE`,
      [schoolId, discount.student_id],
    )
    if (!accountRow) throw new HttpError(404, "No outstanding fee account was found for this discount")
    account = accountRow
    discount.fee_account_id = Number(accountRow.id)
  }
  if (Number(account.student_id) !== Number(discount.student_id)) {
    throw new HttpError(400, "Discount target does not belong to the selected student")
  }
  return { account, invoice }
}

async function applyApprovedDiscount(connection, req, discount) {
  if (discount.status !== "approved" || discount.applied_at) return null
  const schoolId = getScopedSchoolId(req)
  const { account, invoice } = await resolveDiscountTarget(connection, schoolId, discount)
  const amount = discountAppliedAmount(discount, account, invoice)
  await connection.query(
    "UPDATE fee_accounts SET discount_amount = discount_amount + ? WHERE school_id = ? AND id = ?",
    [amount, schoolId, account.id],
  )
  if (invoice) {
    const nextInvoiceDiscount = numberValue(Number(invoice.discount_amount || 0) + amount)
    const nextInvoiceTotal = numberValue(Math.max(0, Number(invoice.subtotal || 0) + Number(invoice.penalty_amount || 0) - nextInvoiceDiscount))
    const nextInvoiceStatus = invoiceStatus(nextInvoiceTotal, invoice.amount_paid, invoice.status)
    await connection.query(
      "UPDATE finance_invoices SET discount_amount = ?, total_amount = ?, status = ? WHERE school_id = ? AND id = ?",
      [nextInvoiceDiscount, nextInvoiceTotal, nextInvoiceStatus, schoolId, invoice.id],
    )
  }
  await connection.query(
    "UPDATE finance_discounts SET fee_account_id = ?, applied_amount = ?, applied_at = CURRENT_TIMESTAMP WHERE school_id = ? AND id = ? AND applied_at IS NULL",
    [account.id, amount, schoolId, discount.id],
  )
  const updatedAccount = await updateAccountTotals(connection, schoolId, account.id)
  await auditFinance(connection, req, "discount.applied", "discount", discount.id, null, { amount, balance: updatedAccount.balance })
  return { amount, balance: updatedAccount.balance }
}

async function nextSequenceNumber(connection, schoolId, table, column, prefix) {
  const sourceKey = `${table}.${column}`
  if (!financeSequenceSources.has(sourceKey)) throw new Error("Unsupported finance sequence source")
  const sequenceKey = `${sourceKey}:${prefix}`
  const [[sequence]] = await connection.query(
    "SELECT next_value FROM finance_sequences WHERE school_id = ? AND sequence_key = ? FOR UPDATE",
    [schoolId, sequenceKey],
  )
  if (!sequence) {
    const [[row]] = await connection.query(
      `SELECT MAX(CAST(SUBSTRING(${column}, ?) AS UNSIGNED)) AS previous
       FROM ${table}
       WHERE school_id = ? AND ${column} LIKE ?`,
      [prefix.length + 1, schoolId, `${prefix}%`],
    )
    const next = (Number(row?.previous || 0) || 0) + 1
    try {
      await connection.query(
        "INSERT INTO finance_sequences (school_id, sequence_key, next_value) VALUES (?, ?, ?)",
        [schoolId, sequenceKey, next + 1],
      )
      return String(next).padStart(6, "0")
    } catch (error) {
      if (error?.code !== "ER_DUP_ENTRY") throw error
      const [[racedSequence]] = await connection.query(
        "SELECT next_value FROM finance_sequences WHERE school_id = ? AND sequence_key = ? FOR UPDATE",
        [schoolId, sequenceKey],
      )
      const racedNext = Number(racedSequence?.next_value || 1)
      await connection.query(
        "UPDATE finance_sequences SET next_value = ? WHERE school_id = ? AND sequence_key = ?",
        [racedNext + 1, schoolId, sequenceKey],
      )
      return String(racedNext).padStart(6, "0")
    }
  }

  const next = Number(sequence.next_value || 1)
  await connection.query(
    "UPDATE finance_sequences SET next_value = ? WHERE school_id = ? AND sequence_key = ?",
    [next + 1, schoolId, sequenceKey],
  )
  return String(next).padStart(6, "0")
}

async function nextInvoiceNo(connection, schoolId, session) {
  const year = new Date().getFullYear()
  const termPart = session?.term?.term_number ? `T${session.term.term_number}` : "T"
  const prefix = `INV-${year}-${termPart}-`
  return `${prefix}${await nextSequenceNumber(connection, schoolId, "finance_invoices", "invoice_no", prefix)}`
}

async function nextReceiptNo(connection, schoolId) {
  const prefix = `RCT-${new Date().getFullYear()}-`
  return `${prefix}${await nextSequenceNumber(connection, schoolId, "fee_payments", "receipt_no", prefix)}`
}

async function accountRows(req, filters = {}, options = {}) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return { rows: [], session, setupRequired: true }
  }
  if (!options.skipSync) {
    await ensureFeeAccountsForActiveStudents(schoolId, { session })
  }

  const conditions = ["f.school_id = ?", "s.status = 'active'"]
  const params = [schoolId]
  const termId = filters.term_id || filters.termId || session.termId
  if (termId) {
    conditions.push("(f.term_id = ? OR (f.term_id IS NULL AND f.term_name = ?))")
    params.push(termId, termNameFromSession(session))
  }
  if (filters.class_id || filters.classId) {
    conditions.push("COALESCE(f.class_id, se.class_id, s.class_id) = ?")
    params.push(filters.class_id || filters.classId)
  }
  if (filters.status) {
    conditions.push("f.status = ?")
    params.push(filters.status)
  }
  if (filters.search) {
    conditions.push("(s.first_name LIKE ? OR s.last_name LIKE ? OR s.admission_no LIKE ? OR s.student_id LIKE ? OR g.primary_phone LIKE ?)")
    const term = `%${filters.search}%`
    params.push(term, term, term, term, term)
  }
  if (filters.min_balance) {
    conditions.push("(f.amount_due + f.penalty_amount - f.discount_amount - f.amount_paid) >= ?")
    params.push(Number(filters.min_balance))
  }
  if (filters.max_balance) {
    conditions.push("(f.amount_due + f.penalty_amount - f.discount_amount - f.amount_paid) <= ?")
    params.push(Number(filters.max_balance))
  }

  const [rows] = await pool.query(
    `SELECT f.id, f.student_id, f.term_name, f.amount_due, f.discount_amount, f.penalty_amount,
      f.amount_paid, (f.amount_due + f.penalty_amount - f.discount_amount - f.amount_paid) AS balance,
      f.status, f.due_date, f.finance_notes, f.academic_year_id, f.term_id, f.class_id, f.fee_structure_id,
      s.first_name, s.last_name, s.admission_no, COALESCE(s.student_id, s.admission_no) AS student_code,
      COALESCE(c.name, current_class.name) AS class_name,
      g.full_name AS guardian_name, g.primary_phone AS guardian_phone, g.email AS guardian_email,
      fp.fee_category, fp.payment_plan, fp.discount_percent, fp.discount_reason,
      MAX(p.paid_at) AS last_payment_at,
      COUNT(DISTINCT i.id) AS invoice_count,
      COUNT(DISTINCT p.id) AS payment_count
     FROM fee_accounts f
     JOIN students s ON s.id = f.student_id AND s.school_id = f.school_id
     LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
      AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
     LEFT JOIN classes current_class ON current_class.id = se.class_id AND current_class.school_id = se.school_id
     LEFT JOIN classes c ON c.id = f.class_id AND c.school_id = f.school_id
     LEFT JOIN student_guardians g ON g.student_id = s.id AND g.school_id = s.school_id AND g.guardian_number = 1
     LEFT JOIN student_fee_profiles fp ON fp.student_id = s.id AND fp.school_id = s.school_id
     LEFT JOIN finance_invoices i ON i.fee_account_id = f.id AND i.school_id = f.school_id
     LEFT JOIN fee_payments p ON p.fee_account_id = f.id AND p.school_id = f.school_id AND p.status = 'posted'
     WHERE ${conditions.join(" AND ")}
     GROUP BY f.id, s.id, c.name, current_class.name, g.id, fp.id
     ORDER BY balance DESC, ${studentCodeSortSql("s")}, s.last_name`,
    [session.academicYearId, session.termId, ...params],
  )
  return { rows, session, setupRequired: false }
}

export async function listFeeAccounts(req, res) {
  const result = await accountRows(req, req.query)
  res.json({ feeAccounts: result.rows, session: sessionPayload(result.session), setup_required: result.setupRequired })
}

export async function syncFeeAccounts(req, res) {
  const schoolId = getScopedSchoolId(req)
  const result = await ensureFeeAccountsForActiveStudents(schoolId)
  res.json({ ok: true, ...result })
}

export async function getFeeAccount(req, res) {
  const schoolId = getScopedSchoolId(req)
  const accountId = Number(req.params.id || 0)
  const result = await accountRows(req, {})
  const account = result.rows.find((row) => Number(row.id) === accountId)
  if (!account) throw new HttpError(404, "Fee account not found")
  const [payments] = await pool.query(
    `SELECT p.*, u.full_name AS recorded_by_name
     FROM fee_payments p
     LEFT JOIN users u ON u.id = p.recorded_by
     WHERE p.school_id = ? AND p.fee_account_id = ?
     ORDER BY p.paid_at DESC, p.id DESC`,
    [schoolId, accountId],
  )
  const [invoices] = await pool.query(
    "SELECT * FROM finance_invoices WHERE school_id = ? AND fee_account_id = ? ORDER BY generated_at DESC",
    [schoolId, accountId],
  )
  const [plans] = await pool.query(
    "SELECT * FROM finance_payment_plans WHERE school_id = ? AND fee_account_id = ? ORDER BY created_at DESC",
    [schoolId, accountId],
  )
  res.json({ account, payments, invoices, paymentPlans: plans })
}

export async function getBursarDashboard(req, res) {
  const schoolId = getScopedSchoolId(req)
  const result = await accountRows(req, req.query, { skipSync: true })
  const accounts = result.rows
  const expected = accounts.reduce((sum, row) => sum + Number(row.amount_due || 0) + Number(row.penalty_amount || 0) - Number(row.discount_amount || 0), 0)
  const collected = accounts.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0)
  const outstanding = expected - collected
  const today = todayDate()

  const [collectionResult, paymentsResult, invoicesResult, classesResult, expensesResult] = await Promise.all([
    pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN COALESCE(paid_on, DATE(paid_at)) = CURRENT_DATE AND status = 'posted' THEN amount ELSE 0 END), 0) AS today_collections,
        COALESCE(SUM(CASE WHEN YEARWEEK(COALESCE(paid_on, DATE(paid_at)), 1) = YEARWEEK(CURRENT_DATE, 1) AND status = 'posted' THEN amount ELSE 0 END), 0) AS week_collections,
        COALESCE(SUM(CASE WHEN YEAR(COALESCE(paid_on, DATE(paid_at))) = YEAR(CURRENT_DATE) AND MONTH(COALESCE(paid_on, DATE(paid_at))) = MONTH(CURRENT_DATE) AND status = 'posted' THEN amount ELSE 0 END), 0) AS month_collections
       FROM fee_payments WHERE school_id = ?`,
      [schoolId],
    ),
    pool.query(
      `SELECT p.id, p.amount, p.payment_method, p.reference, p.receipt_no, p.paid_at,
        s.first_name, s.last_name, s.admission_no
       FROM fee_payments p
       JOIN fee_accounts f ON f.id = p.fee_account_id AND f.school_id = p.school_id
       JOIN students s ON s.id = f.student_id AND s.school_id = f.school_id
       WHERE p.school_id = ?
       ORDER BY COALESCE(p.paid_on, DATE(p.paid_at)) DESC, p.id DESC LIMIT 8`,
      [schoolId],
    ),
    pool.query(
      `SELECT i.id, i.invoice_no, i.status, i.total_amount, i.amount_paid, i.due_date, i.generated_at,
        s.first_name, s.last_name, s.admission_no
       FROM finance_invoices i
       JOIN students s ON s.id = i.student_id AND s.school_id = i.school_id
       WHERE i.school_id = ?
       ORDER BY i.generated_at DESC, i.id DESC LIMIT 8`,
      [schoolId],
    ),
    pool.query(
      `SELECT COALESCE(c.name, 'Unassigned') AS class_name,
        COUNT(*) AS account_count,
        COALESCE(SUM(f.amount_due + f.penalty_amount - f.discount_amount - f.amount_paid), 0) AS outstanding
       FROM fee_accounts f
       LEFT JOIN classes c ON c.id = f.class_id AND c.school_id = f.school_id
       WHERE f.school_id = ?
       GROUP BY c.name
       HAVING outstanding > 0
       ORDER BY outstanding DESC LIMIT 6`,
      [schoolId],
    ),
    pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN status IN ('approved', 'paid') THEN amount ELSE 0 END), 0) AS approved_expenses,
        COALESCE(SUM(CASE WHEN status = 'pending_approval' THEN amount ELSE 0 END), 0) AS pending_expenses
       FROM finance_expenses WHERE school_id = ?`,
      [schoolId],
    ),
  ])
  const [collectionWindows] = collectionResult
  const [recentPayments] = paymentsResult
  const [recentInvoices] = invoicesResult
  const [topClasses] = classesResult
  const [expenseRows] = expensesResult
  const expenses = expenseRows[0] || {}

  res.json({
    session: sessionPayload(result.session),
    summary: {
      expectedFees: numberValue(expected),
      collectedFees: numberValue(collected),
      outstandingBalance: numberValue(outstanding),
      collectionRate: expected > 0 ? numberValue((collected / expected) * 100) : 0,
      fullyPaidStudents: accounts.filter((row) => Number(row.balance || 0) <= 0).length,
      unpaidStudents: accounts.filter((row) => Number(row.amount_paid || 0) <= 0 && Number(row.balance || 0) > 0).length,
      partiallyPaidStudents: accounts.filter((row) => Number(row.amount_paid || 0) > 0 && Number(row.balance || 0) > 0).length,
      studentsInArrears: accounts.filter((row) => Number(row.balance || 0) > 0 && row.due_date && String(row.due_date).slice(0, 10) < today).length,
      todayCollections: numberValue(collectionWindows[0]?.today_collections || 0),
      weekCollections: numberValue(collectionWindows[0]?.week_collections || 0),
      monthCollections: numberValue(collectionWindows[0]?.month_collections || 0),
      pendingPaymentConfirmations: 0,
      approvedExpenses: numberValue(expenses?.approved_expenses || 0),
      pendingExpenses: numberValue(expenses?.pending_expenses || 0),
    },
    alerts: accounts
      .filter((row) => Number(row.balance || 0) > 0 && row.due_date && String(row.due_date).slice(0, 10) < today)
      .slice(0, 6),
    recentPayments,
    recentInvoices,
    topOwingClasses: topClasses,
  })
}

export async function listFeeStructures(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [structures] = await pool.query(
    `SELECT fs.*, c.name AS class_name, ay.name AS academic_year_name, t.name AS term_name,
      COALESCE(SUM(fi.amount), 0) AS total_amount,
      COUNT(fi.id) AS item_count
     FROM finance_fee_structures fs
     LEFT JOIN finance_fee_structure_items fi ON fi.fee_structure_id = fs.id AND fi.school_id = fs.school_id
     LEFT JOIN classes c ON c.id = fs.class_id AND c.school_id = fs.school_id
     LEFT JOIN academic_years ay ON ay.id = fs.academic_year_id AND ay.school_id = fs.school_id
     LEFT JOIN terms t ON t.id = fs.term_id AND t.school_id = fs.school_id
     WHERE fs.school_id = ?
     GROUP BY fs.id, c.name, ay.name, t.name
     ORDER BY fs.created_at DESC`,
    [schoolId],
  )
  res.json({ structures })
}

export async function createFeeStructure(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await requireActiveAcademicSession(schoolId)
  const items = Array.isArray(req.body.items) ? req.body.items : []
  const normalizedItems = []
  items.forEach((item, index) => {
    const itemName = cleanText(item.item_name || item.itemName || item.name, 120)
    const hasAmount = item.amount !== undefined && item.amount !== null && String(item.amount).trim() !== ""
    if (!itemName && !hasAmount) return
    if (!itemName) throw new HttpError(400, "Fee item name is required")
    normalizedItems.push({
      itemName,
      itemType: enumValue(item.item_type || item.itemType || "other", feeItemTypes, "other", "fee item type"),
      amount: moneyValue(item.amount, "fee item amount"),
      sortOrder: index,
    })
  })
  if (!normalizedItems.length) throw new HttpError(400, "At least one fee item is required")
  const name = cleanText(req.body.name, 160) || `${termNameFromSession(session)} fees`
  const classId = Number(req.body.class_id || req.body.classId || 0) || null
  const academicYearId = Number(req.body.academic_year_id || req.body.academicYearId || session.academicYearId) || null
  const termId = Number(req.body.term_id || req.body.termId || session.termId) || null
  const dueDate = dateValue(req.body.due_date || req.body.dueDate, "due date")
  const latePenaltyType = enumValue(req.body.late_penalty_type || req.body.latePenaltyType || "none", latePenaltyTypes, "none", "late penalty type")
  const latePenaltyValue = latePenaltyType === "none" ? 0 : numberValue(req.body.late_penalty_value || req.body.latePenaltyValue || 0)
  if (!Number.isFinite(latePenaltyValue) || latePenaltyValue < 0) throw new HttpError(400, "late penalty value must be zero or greater")
  if (latePenaltyType !== "none" && latePenaltyValue <= 0) throw new HttpError(400, "late penalty value is required when a penalty type is selected")
  if (latePenaltyType === "percent" && latePenaltyValue > 100) throw new HttpError(400, "late penalty percent cannot exceed 100")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.query(
      `INSERT INTO finance_fee_structures (
        school_id, academic_year_id, term_id, class_id, name, due_date,
        late_penalty_type, late_penalty_value, discount_rules_json, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [
        schoolId,
        academicYearId,
        termId,
        classId,
        name,
        dueDate,
        latePenaltyType,
        latePenaltyValue,
        req.body.discount_rules || req.body.discountRules ? JSON.stringify(req.body.discount_rules || req.body.discountRules) : null,
        req.user.id,
      ],
    )
    const structureId = Number(result.insertId)
    for (const item of normalizedItems) {
      await connection.query(
        `INSERT INTO finance_fee_structure_items (school_id, fee_structure_id, item_name, item_type, amount, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [schoolId, structureId, item.itemName, item.itemType, item.amount, item.sortOrder],
      )
    }
    await auditFinance(connection, req, "fee_structure.created", "fee_structure", structureId, null, { name, items: normalizedItems })
    await connection.commit()
    res.status(201).json({ structureId })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function applyFeeStructure(req, res) {
  const schoolId = getScopedSchoolId(req)
  const structureId = Number(req.params.id || req.body.fee_structure_id || 0)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[structure]] = await connection.query("SELECT * FROM finance_fee_structures WHERE school_id = ? AND id = ? AND status = 'active' LIMIT 1", [schoolId, structureId])
    if (!structure) throw new HttpError(404, "Fee structure not found")
    const [[totalRow]] = await connection.query("SELECT COALESCE(SUM(amount), 0) AS total FROM finance_fee_structure_items WHERE school_id = ? AND fee_structure_id = ?", [schoolId, structureId])
    const total = moneyValue(totalRow?.total || 0, "fee structure total")
    const termName = structure.term_id
      ? `${(await connection.query("SELECT name FROM terms WHERE school_id = ? AND id = ?", [schoolId, structure.term_id]))[0]?.[0]?.name || "Term"} ${(await connection.query("SELECT name FROM academic_years WHERE school_id = ? AND id = ?", [schoolId, structure.academic_year_id]))[0]?.[0]?.name || ""}`.trim()
      : cleanText(req.body.term_name || req.body.termName, 80) || "Finance Term"
    const conditions = ["s.school_id = ?", "s.status = 'active'"]
    const params = [schoolId]
    if (structure.class_id) {
      conditions.push("COALESCE(se.class_id, s.class_id) = ?")
      params.push(structure.class_id)
    }
    const [students] = await connection.query(
      `SELECT s.id, COALESCE(se.class_id, s.class_id) AS class_id
       FROM students s
       LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
        AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
       WHERE ${conditions.join(" AND ")}`,
      [structure.academic_year_id, structure.term_id, ...params],
    )
    let created = 0
    let skipped = 0
    for (const student of students) {
      const [result] = await connection.query(
        `INSERT IGNORE INTO fee_accounts (
          school_id, student_id, academic_year_id, term_id, class_id, fee_structure_id,
          term_name, amount_due, amount_paid, status, due_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'unpaid', ?)`,
        [schoolId, student.id, structure.academic_year_id, structure.term_id, student.class_id || structure.class_id, structureId, termName, total, structure.due_date],
      )
      if (result.affectedRows) created += 1
      else skipped += 1
    }
    await connection.query(
      `INSERT INTO finance_fee_structure_applications (
        school_id, fee_structure_id, academic_year_id, term_id, class_id, applied_by, accounts_created, accounts_skipped
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE accounts_created = VALUES(accounts_created), accounts_skipped = VALUES(accounts_skipped), applied_by = VALUES(applied_by)`,
      [schoolId, structureId, structure.academic_year_id, structure.term_id, structure.class_id, req.user.id, created, skipped],
    )
    await auditFinance(connection, req, "fee_structure.applied", "fee_structure", structureId, null, { accountsCreated: created, accountsSkipped: skipped })
    await connection.commit()
    res.json({ accounts_created: created, accounts_skipped: skipped })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function createInvoiceForAccount(connection, req, account, session) {
  const schoolId = getScopedSchoolId(req)
  const total = numberValue(Number(account.amount_due || 0) + Number(account.penalty_amount || 0) - Number(account.discount_amount || 0))
  if (total <= 0) return { skipped: true, reason: "zero_total", invoiceId: null, invoiceNo: null }
  const [existing] = await connection.query(
    `SELECT id, invoice_no FROM finance_invoices
     WHERE school_id = ? AND fee_account_id = ? AND status IN ('unpaid', 'partial', 'paid')
     ORDER BY id DESC LIMIT 1`,
    [schoolId, account.id],
  )
  if (existing.length) return { skipped: true, invoiceId: Number(existing[0].id), invoiceNo: existing[0].invoice_no }
  const invoiceNo = await nextInvoiceNo(connection, schoolId, session)
  const [invoiceResult] = await connection.query(
    `INSERT INTO finance_invoices (
      school_id, fee_account_id, student_id, invoice_no, academic_year_id, term_id,
      status, subtotal, discount_amount, penalty_amount, total_amount, amount_paid,
      due_date, payment_instructions, generated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      account.id,
      account.student_id,
      invoiceNo,
      account.academic_year_id,
      account.term_id,
      invoiceStatus(total, account.amount_paid),
      account.amount_due,
      account.discount_amount,
      account.penalty_amount,
      total,
      account.amount_paid,
      account.due_date,
      cleanText(req.body.payment_instructions || req.body.paymentInstructions, 1000),
      req.user.id,
    ],
  )
  const invoiceId = Number(invoiceResult.insertId)
  const [items] = account.fee_structure_id
    ? await connection.query("SELECT * FROM finance_fee_structure_items WHERE school_id = ? AND fee_structure_id = ? ORDER BY sort_order, id", [schoolId, account.fee_structure_id])
    : [[]]
  const invoiceItems = items.length ? items : [{ item_name: "School fees", item_type: "tuition", amount: account.amount_due, sort_order: 0 }]
  for (const item of invoiceItems) {
    await connection.query(
      `INSERT INTO finance_invoice_items (school_id, invoice_id, item_name, item_type, quantity, unit_amount, line_total, sort_order)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      [schoolId, invoiceId, item.item_name, item.item_type || "other", item.amount, item.amount, item.sort_order || 0],
    )
  }
  await auditFinance(connection, req, "invoice.generated", "invoice", invoiceId, null, { invoiceNo, total })
  return { skipped: false, invoiceId, invoiceNo }
}

export async function generateInvoices(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const accountIds = Array.isArray(req.body.fee_account_ids || req.body.feeAccountIds)
    ? (req.body.fee_account_ids || req.body.feeAccountIds).map(Number).filter(Boolean)
    : []
  const classId = Number(req.body.class_id || req.body.classId || 0) || null
  const studentId = Number(req.body.student_id || req.body.studentId || 0) || null
  const conditions = ["school_id = ?"]
  const params = [schoolId]
  const hasExplicitScope = Boolean(accountIds.length || classId || studentId)
  if (!hasExplicitScope) {
    if (session.setupRequired) throw new HttpError(409, "Open an academic year and term before bulk invoice generation.")
    conditions.push("(term_id = ? OR (term_id IS NULL AND term_name = ?))")
    params.push(session.termId, termNameFromSession(session))
  }
  if (accountIds.length) {
    conditions.push(`id IN (${accountIds.map(() => "?").join(",")})`)
    params.push(...accountIds)
  }
  if (classId) {
    conditions.push("class_id = ?")
    params.push(classId)
  }
  if (studentId) {
    conditions.push("student_id = ?")
    params.push(studentId)
  }
  conditions.push("(amount_due + penalty_amount - discount_amount) > 0")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [accounts] = await connection.query(`SELECT * FROM fee_accounts WHERE ${conditions.join(" AND ")}`, params)
    let generated = 0
    let skipped = 0
    const invoices = []
    for (const account of accounts) {
      const invoice = await createInvoiceForAccount(connection, req, account, session)
      invoices.push(invoice)
      if (invoice.skipped) skipped += 1
      else generated += 1
    }
    await connection.commit()
    res.status(201).json({ generated, skipped, invoices })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listInvoices(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [invoices] = await pool.query(
    `SELECT i.*, s.first_name, s.last_name, s.admission_no, c.name AS class_name, g.full_name AS guardian_name, g.primary_phone AS guardian_phone
     FROM finance_invoices i
     JOIN students s ON s.id = i.student_id AND s.school_id = i.school_id
     JOIN fee_accounts f ON f.id = i.fee_account_id AND f.school_id = i.school_id
     LEFT JOIN classes c ON c.id = f.class_id AND c.school_id = f.school_id
     LEFT JOIN student_guardians g ON g.student_id = s.id AND g.school_id = s.school_id AND g.guardian_number = 1
     WHERE i.school_id = ?
     ORDER BY i.generated_at DESC, i.id DESC`,
    [schoolId],
  )
  res.json({ invoices })
}

export async function recordPayment(req, res) {
  const schoolId = getScopedSchoolId(req)
  let feeAccountId = Number(req.body.fee_account_id || req.body.feeAccountId || 0)
  let invoiceId = Number(req.body.invoice_id || req.body.invoiceId || 0) || null
  const invoiceNo = cleanText(req.body.invoice_no || req.body.invoiceNo, 80)
  const amount = moneyValue(req.body.amount, "payment amount")
  const paymentDate = dateValue(req.body.payment_date || req.body.paymentDate, "payment date", { allowFuture: false }) || todayDate()
  const method = normalizePaymentMethod(req.body.payment_method || req.body.paymentMethod, { strict: true })

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    let invoice = null
    if (invoiceId || invoiceNo) {
      const invoiceWhere = invoiceId ? "i.id = ?" : "i.invoice_no = ?"
      const invoiceParam = invoiceId || invoiceNo
      const [[invoiceRow]] = await connection.query(
        `SELECT i.*, f.id AS resolved_fee_account_id
         FROM finance_invoices i
         JOIN fee_accounts f ON f.id = i.fee_account_id AND f.school_id = i.school_id
         WHERE i.school_id = ? AND ${invoiceWhere}
         LIMIT 1
         FOR UPDATE`,
        [schoolId, invoiceParam],
      )
      if (!invoiceRow) throw new HttpError(404, "Invoice was not found")
      if (["cancelled", "reversed"].includes(String(invoiceRow.status || "").toLowerCase())) {
        throw new HttpError(400, "Payments cannot be recorded against a cancelled or reversed invoice")
      }
      if (feeAccountId && Number(invoiceRow.resolved_fee_account_id) !== feeAccountId) {
        throw new HttpError(400, "Invoice number does not belong to the selected fee account")
      }
      invoice = invoiceRow
      feeAccountId = Number(invoiceRow.resolved_fee_account_id)
      invoiceId = Number(invoiceRow.id)
    }
    if (!feeAccountId) throw new HttpError(400, "Select a fee account or enter a valid invoice number")

    const [[account]] = await connection.query("SELECT * FROM fee_accounts WHERE id = ? AND school_id = ? FOR UPDATE", [feeAccountId, schoolId])
    if (!account) throw new HttpError(404, "Fee account not found")
    const before = accountBalance(account)
    if (before <= 0 && !booleanValue(req.body.allow_overpayment || req.body.allowOverpayment)) {
      throw new HttpError(400, "This account is already settled. Enable overpayment only when you are intentionally recording a credit.")
    }
    if (amount > before && !booleanValue(req.body.allow_overpayment || req.body.allowOverpayment)) throw new HttpError(400, "Payment is greater than the outstanding balance")
    const providedReference = cleanText(req.body.reference, 120)
    if (method !== "cash" && !providedReference) throw new HttpError(400, "Bank, mobile, cheque and card payments need the real transaction reference")
    const reference = providedReference || invoice?.invoice_no || null
    if (method !== "cash" && reference) {
      const [[duplicateReference]] = await connection.query(
        `SELECT id, receipt_no FROM fee_payments
         WHERE school_id = ? AND status = 'posted' AND payment_method = ? AND reference = ?
          AND amount = ? AND COALESCE(paid_on, DATE(paid_at)) = ?
         LIMIT 1`,
        [schoolId, method, reference, amount, paymentDate],
      )
      if (duplicateReference) {
        throw new HttpError(409, `This payment reference already appears on receipt ${duplicateReference.receipt_no || duplicateReference.id}`)
      }
    }

    const receiptNo = await nextReceiptNo(connection, schoolId)
    const balanceAfter = numberValue(before - amount)
    const [result] = await connection.query(
      `INSERT INTO fee_payments (
        school_id, fee_account_id, invoice_id, amount, status, payment_method, reference,
        paid_on, notes, attachment_url, balance_before, balance_after, receipt_no, recorded_by
      ) VALUES (?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        feeAccountId,
        invoiceId,
        amount,
        method,
        reference,
        paymentDate,
        cleanText(req.body.notes, 2000),
        cleanText(req.body.attachment_url || req.body.attachmentUrl, 255),
        before,
        balanceAfter,
        receiptNo,
        req.user.id,
      ],
    )
    const paymentId = Number(result.insertId)
    const updatedAccount = await updateAccountTotals(connection, schoolId, feeAccountId)
    await auditFinance(connection, req, "payment.recorded", "payment", paymentId, { balance: before }, { amount, receiptNo, balance: updatedAccount.balance })
    await connection.commit()
    res.status(201).json({ receiptNo, paymentId, balance_before: before, balance_after: updatedAccount.balance })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listPayments(req, res) {
  const schoolId = getScopedSchoolId(req)
  const conditions = ["p.school_id = ?"]
  const params = [schoolId]
  const status = cleanText(req.query.status, 20)
  if (status) {
    if (!["posted", "reversed", "void"].includes(status)) throw new HttpError(400, "payment status is not supported")
    conditions.push("p.status = ?")
    params.push(status)
  }
  if (req.query.payment_method || req.query.paymentMethod) {
    conditions.push("p.payment_method = ?")
    params.push(normalizePaymentMethod(req.query.payment_method || req.query.paymentMethod, { strict: true }))
  }
  const dateFrom = dateValue(req.query.date_from || req.query.dateFrom, "date_from")
  const dateTo = dateValue(req.query.date_to || req.query.dateTo, "date_to")
  if (dateFrom && dateTo && dateFrom > dateTo) throw new HttpError(400, "date_from cannot be after date_to")
  if (dateFrom) {
    conditions.push("COALESCE(p.paid_on, DATE(p.paid_at)) >= ?")
    params.push(dateFrom)
  }
  if (dateTo) {
    conditions.push("COALESCE(p.paid_on, DATE(p.paid_at)) <= ?")
    params.push(dateTo)
  }
  const [payments] = await pool.query(
    `SELECT p.*, s.first_name, s.last_name, s.admission_no, c.name AS class_name, u.full_name AS recorded_by_name
     FROM fee_payments p
     JOIN fee_accounts f ON f.id = p.fee_account_id AND f.school_id = p.school_id
     JOIN students s ON s.id = f.student_id AND s.school_id = f.school_id
     LEFT JOIN classes c ON c.id = f.class_id AND c.school_id = f.school_id
     LEFT JOIN users u ON u.id = p.recorded_by
     WHERE ${conditions.join(" AND ")}
     ORDER BY COALESCE(p.paid_on, DATE(p.paid_at)) DESC, p.id DESC LIMIT 200`,
    params,
  )
  res.json({ payments })
}

export async function getPaymentReceiptPdf(req, res) {
  const schoolId = getScopedSchoolId(req)
  const paymentId = Number(req.params.id || 0)
  if (!paymentId) throw new HttpError(400, "Payment id is required")
  const [[receipt]] = await pool.query(
    `SELECT p.*, f.term_name, f.amount_due, f.discount_amount, f.penalty_amount,
      s.first_name, s.last_name, s.admission_no, COALESCE(s.student_id, s.admission_no) AS student_code,
      c.name AS class_name, u.full_name AS recorded_by_name,
      sc.name AS school_name, sc.code AS school_code, sc.school_prefix, sc.city AS school_city, sc.country AS school_country
     FROM fee_payments p
     JOIN fee_accounts f ON f.id = p.fee_account_id AND f.school_id = p.school_id
     JOIN students s ON s.id = f.student_id AND s.school_id = f.school_id
     JOIN schools sc ON sc.id = p.school_id
     LEFT JOIN classes c ON c.id = f.class_id AND c.school_id = f.school_id
     LEFT JOIN users u ON u.id = p.recorded_by
     WHERE p.school_id = ? AND p.id = ?
     LIMIT 1`,
    [schoolId, paymentId],
  )
  if (!receipt) throw new HttpError(404, "Receipt was not found")
  const template = await getReportPdfTemplateForSchool(pool, schoolId, receipt)
  drawReceiptPdf(receipt, res, template)
}

export async function reversePayment(req, res) {
  const schoolId = getScopedSchoolId(req)
  const paymentId = Number(req.params.id || 0)
  const reason = cleanText(req.body.reason, 2000)
  if (!reason) throw new HttpError(400, "Reversal reason is required")
  if (!isOversightUser(req.user)) throw new HttpError(403, "Only school leadership can reverse posted payments")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[payment]] = await connection.query("SELECT * FROM fee_payments WHERE school_id = ? AND id = ? FOR UPDATE", [schoolId, paymentId])
    if (!payment) throw new HttpError(404, "Payment not found")
    if (payment.status !== "posted") throw new HttpError(400, "Only posted payments can be reversed")
    await connection.query("UPDATE fee_payments SET status = 'reversed', reversed_at = CURRENT_TIMESTAMP, reversed_by = ? WHERE school_id = ? AND id = ?", [req.user.id, schoolId, paymentId])
    await connection.query(
      "INSERT INTO finance_payment_reversals (school_id, payment_id, fee_account_id, amount, reason, reversed_by) VALUES (?, ?, ?, ?, ?, ?)",
      [schoolId, paymentId, payment.fee_account_id, payment.amount, reason, req.user.id],
    )
    const updatedAccount = await updateAccountTotals(connection, schoolId, payment.fee_account_id)
    await auditFinance(connection, req, "payment.reversed", "payment", paymentId, payment, { reason, balance: updatedAccount.balance })
    await connection.commit()
    res.json({ ok: true, balance_after: updatedAccount.balance })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listArrears(req, res) {
  const result = await accountRows(req, req.query, { skipSync: true })
  const today = new Date(todayDate())
  const arrears = result.rows
    .filter((row) => Number(row.balance || 0) > 0 && row.due_date && String(row.due_date).slice(0, 10) < todayDate())
    .map((row) => {
      const due = new Date(String(row.due_date).slice(0, 10))
      const daysOverdue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000))
      return {
        ...row,
        days_overdue: daysOverdue,
        risk_level: daysOverdue >= 30 || Number(row.balance || 0) >= 500000 ? "High" : daysOverdue >= 14 ? "Medium" : "Low",
      }
    })
  res.json({ arrears })
}

export async function listPaymentPlans(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [plans] = await pool.query(
    `SELECT pp.*, s.first_name, s.last_name, s.admission_no, c.name AS class_name,
      MIN(CASE WHEN pi.status IN ('upcoming', 'overdue') THEN pi.due_date ELSE NULL END) AS next_due_date,
      SUM(CASE WHEN pi.status = 'overdue' OR (pi.status = 'upcoming' AND pi.due_date < CURRENT_DATE) THEN pi.amount ELSE 0 END) AS overdue_amount
     FROM finance_payment_plans pp
     JOIN students s ON s.id = pp.student_id AND s.school_id = pp.school_id
     LEFT JOIN fee_accounts f ON f.id = pp.fee_account_id AND f.school_id = pp.school_id
     LEFT JOIN classes c ON c.id = f.class_id AND c.school_id = f.school_id
     LEFT JOIN finance_payment_plan_installments pi ON pi.payment_plan_id = pp.id AND pi.school_id = pp.school_id
     WHERE pp.school_id = ?
     GROUP BY pp.id, s.id, c.name
     ORDER BY pp.created_at DESC`,
    [schoolId],
  )
  res.json({
    paymentPlans: plans.map((plan) => ({
      ...plan,
      overdue_amount: numberValue(plan.overdue_amount || 0),
      status: plan.status === "active" && Number(plan.overdue_amount || 0) > 0 ? "defaulted" : plan.status,
    })),
  })
}

export async function createPaymentPlan(req, res) {
  const schoolId = getScopedSchoolId(req)
  let studentId = Number(req.body.student_id || req.body.studentId || 0)
  const feeAccountId = Number(req.body.fee_account_id || req.body.feeAccountId || 0) || null
  const installmentCount = Math.max(1, Number(req.body.installment_count || req.body.installmentCount || 0))
  if (installmentCount > 36) throw new HttpError(400, "installment count cannot exceed 36")
  const installmentAmount = moneyValue(req.body.installment_amount || req.body.installmentAmount, "installment amount")
  let totalBalance = moneyValue(req.body.total_balance || req.body.totalBalance || installmentAmount * installmentCount, "total balance")
  const startDate = dateValue(req.body.start_date || req.body.startDate, "start date") || todayDate()
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    let account = null
    if (feeAccountId) {
      const [[accountRow]] = await connection.query("SELECT * FROM fee_accounts WHERE school_id = ? AND id = ? FOR UPDATE", [schoolId, feeAccountId])
      if (!accountRow) throw new HttpError(404, "Fee account not found")
      account = accountRow
      studentId = Number(account.student_id)
      const balance = accountBalance(account)
      if (balance <= 0) throw new HttpError(400, "Payment plans can only be created for accounts with an outstanding balance")
      if (totalBalance > balance) throw new HttpError(400, "Payment plan total cannot exceed the outstanding balance")
      totalBalance = numberValue(totalBalance)
      const [[existingPlan]] = await connection.query(
        "SELECT id FROM finance_payment_plans WHERE school_id = ? AND fee_account_id = ? AND status = 'active' LIMIT 1",
        [schoolId, feeAccountId],
      )
      if (existingPlan) throw new HttpError(409, "This fee account already has an active payment plan")
    }
    if (!studentId) throw new HttpError(400, "student_id is required")
    if (installmentCount > 1 && installmentAmount * (installmentCount - 1) >= totalBalance) {
      throw new HttpError(400, "Installment amount is too high for the selected balance and installment count")
    }
    const [result] = await connection.query(
      `INSERT INTO finance_payment_plans (school_id, student_id, fee_account_id, total_balance, installment_amount, installment_count, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, studentId, feeAccountId, totalBalance, installmentAmount, installmentCount, cleanText(req.body.notes, 2000), req.user.id],
    )
    const planId = Number(result.insertId)
    let remaining = totalBalance
    for (let index = 0; index < installmentCount; index += 1) {
      const due = new Date(startDate)
      due.setMonth(due.getMonth() + index)
      const amount = index === installmentCount - 1 ? numberValue(remaining) : numberValue(Math.min(installmentAmount, remaining))
      remaining = numberValue(remaining - amount)
      await connection.query(
        "INSERT INTO finance_payment_plan_installments (school_id, payment_plan_id, installment_no, due_date, amount) VALUES (?, ?, ?, ?, ?)",
        [schoolId, planId, index + 1, due.toISOString().slice(0, 10), amount],
      )
    }
    await auditFinance(connection, req, "payment_plan.created", "payment_plan", planId, null, { totalBalance, installmentAmount, installmentCount })
    await connection.commit()
    res.status(201).json({ paymentPlanId: planId })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listDiscounts(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [discounts] = await pool.query(
    `SELECT d.*, s.first_name, s.last_name, s.admission_no, u.full_name AS requested_by_name, a.full_name AS approved_by_name
     FROM finance_discounts d
     JOIN students s ON s.id = d.student_id AND s.school_id = d.school_id
     LEFT JOIN users u ON u.id = d.requested_by
     LEFT JOIN users a ON a.id = d.approved_by
     WHERE d.school_id = ?
     ORDER BY d.created_at DESC`,
    [schoolId],
  )
  res.json({ discounts })
}

export async function createDiscount(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = Number(req.body.student_id || req.body.studentId || 0)
  const reason = cleanText(req.body.reason, 2000)
  if (!studentId || !reason) throw new HttpError(400, "student_id and reason are required")
  const amountType = enumValue(req.body.amount_type || req.body.amountType || "amount", discountAmountTypes, "amount", "discount amount type")
  const amountValue = moneyValue(req.body.amount_value || req.body.amountValue, "discount value")
  if (amountType === "percent" && amountValue > 100) throw new HttpError(400, "discount percent cannot exceed 100")
  const discountType = enumValue(req.body.discount_type || req.body.discountType || "manual", discountTypes, "manual", "discount type")
  const feeAccountId = Number(req.body.fee_account_id || req.body.feeAccountId || 0) || null
  const invoiceId = Number(req.body.invoice_id || req.body.invoiceId || 0) || null
  const status = isOversightUser(req.user) && amountType === "amount" && amountValue <= 100000 ? "approved" : "pending"
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.query(
      `INSERT INTO finance_discounts (
        school_id, student_id, fee_account_id, invoice_id, discount_type, amount_type,
        amount_value, reason, status, requested_by, approved_by, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${status === "approved" ? "CURRENT_TIMESTAMP" : "NULL"})`,
      [
        schoolId,
        studentId,
        feeAccountId,
        invoiceId,
        discountType,
        amountType,
        amountValue,
        reason,
        status,
        req.user.id,
        status === "approved" ? req.user.id : null,
      ],
    )
    const discountId = Number(result.insertId)
    if (status === "approved") {
      await applyApprovedDiscount(connection, req, {
        id: discountId,
        school_id: schoolId,
        student_id: studentId,
        fee_account_id: feeAccountId,
        invoice_id: invoiceId,
        amount_type: amountType,
        amount_value: amountValue,
        status,
      })
    }
    await auditFinance(connection, req, "discount.requested", "discount", discountId, null, { status, amountType, amountValue })
    await connection.commit()
    res.status(201).json({ discountId, status })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function transitionDiscount(req, res) {
  if (!isOversightUser(req.user)) throw new HttpError(403, "Only leadership can approve or reject discounts")
  const schoolId = getScopedSchoolId(req)
  const discountId = Number(req.params.id || 0)
  const status = req.params.action === "approve" ? "approved" : "rejected"
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[discount]] = await connection.query("SELECT * FROM finance_discounts WHERE school_id = ? AND id = ? FOR UPDATE", [schoolId, discountId])
    if (!discount) throw new HttpError(404, "Discount not found")
    if (discount.status !== "pending") throw new HttpError(400, "Only pending discounts can be approved or rejected")
    await connection.query(
      "UPDATE finance_discounts SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE school_id = ? AND id = ?",
      [status, req.user.id, schoolId, discountId],
    )
    if (status === "approved") {
      await applyApprovedDiscount(connection, req, { ...discount, status })
    }
    await auditFinance(connection, req, `discount.${status}`, "discount", discountId, discount, { status })
    await connection.commit()
    res.json({ ok: true, status })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listExpenses(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [expenses] = await pool.query("SELECT * FROM finance_expenses WHERE school_id = ? ORDER BY expense_date DESC, id DESC", [schoolId])
  res.json({ expenses })
}

export async function createExpense(req, res) {
  const schoolId = getScopedSchoolId(req)
  const amount = moneyValue(req.body.amount, "expense amount")
  const title = cleanText(req.body.title, 180)
  if (!title) throw new HttpError(400, "Expense title is required")
  const category = enumValue(req.body.category || "other", expenseCategories, "other", "expense category")
  const expenseDate = dateValue(req.body.expense_date || req.body.expenseDate, "expense date", { allowFuture: false }) || todayDate()
  const method = normalizePaymentMethod(req.body.payment_method || req.body.paymentMethod, { strict: true })
  const reference = cleanText(req.body.reference, 120)
  if (method !== "cash" && !reference) throw new HttpError(400, "Reference is required for non-cash expenses")
  const status = enumValue(req.body.status || "pending_approval", expenseStatuses, "pending_approval", "expense status")
  if (!isOversightUser(req.user) && ["approved", "paid", "rejected"].includes(status)) {
    throw new HttpError(403, "Only leadership can approve, reject, or mark expenses as paid")
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.query(
      `INSERT INTO finance_expenses (
        school_id, title, category, supplier, amount, expense_date, payment_method,
        reference, attachment_url, description, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        title,
        category,
        cleanText(req.body.supplier, 160),
        amount,
        expenseDate,
        method,
        reference,
        cleanText(req.body.attachment_url || req.body.attachmentUrl, 255),
        cleanText(req.body.description, 2000),
        status,
        req.user.id,
      ],
    )
    await auditFinance(connection, req, "expense.created", "expense", Number(result.insertId), null, { title, amount })
    await connection.commit()
    res.status(201).json({ expenseId: Number(result.insertId) })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function transitionExpense(req, res) {
  if (!isOversightUser(req.user)) throw new HttpError(403, "Only leadership can approve, reject, or mark expenses as paid")
  const schoolId = getScopedSchoolId(req)
  const expenseId = Number(req.params.id || 0)
  const action = String(req.params.action || "").toLowerCase()
  const nextStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "pay" ? "paid" : null
  if (!expenseId || !nextStatus) throw new HttpError(400, "Unsupported expense action")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[expense]] = await connection.query("SELECT * FROM finance_expenses WHERE school_id = ? AND id = ? FOR UPDATE", [schoolId, expenseId])
    if (!expense) throw new HttpError(404, "Expense not found")
    if (nextStatus === "paid" && expense.status !== "approved") throw new HttpError(400, "Only approved expenses can be marked as paid")
    if (["approved", "rejected"].includes(nextStatus) && !["draft", "pending_approval"].includes(expense.status)) {
      throw new HttpError(400, "Only draft or pending expenses can be approved or rejected")
    }
    await connection.query(
      `UPDATE finance_expenses
       SET status = ?, approved_by = ?, approved_at = CASE WHEN ? IN ('approved', 'paid') THEN CURRENT_TIMESTAMP ELSE approved_at END
       WHERE school_id = ? AND id = ?`,
      [nextStatus, req.user.id, nextStatus, schoolId, expenseId],
    )
    await auditFinance(connection, req, `expense.${nextStatus}`, "expense", expenseId, expense, { status: nextStatus })
    await connection.commit()
    res.json({ ok: true, status: nextStatus })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

function csvValue(value) {
  const raw = String(value ?? "")
  const text = /^[\t\r]/.test(raw) || /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function sendCsv(res, filename, columns, rows) {
  const lines = [
    columns.map((column) => csvValue(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => csvValue(row[column.key])).join(",")),
  ]
  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  res.send(lines.join("\n"))
}

export async function getFinanceReports(req, res) {
  const schoolId = getScopedSchoolId(req)
  const dateFrom = dateValue(req.query.date_from || req.query.dateFrom, "date_from")
  const dateTo = dateValue(req.query.date_to || req.query.dateTo, "date_to")
  if (dateFrom && dateTo && dateFrom > dateTo) throw new HttpError(400, "date_from cannot be after date_to")

  const balances = await accountRows(req, req.query, { skipSync: true })
  if (String(req.query.format || "").toLowerCase() === "csv") {
    return sendCsv(
      res,
      `fee-balances-${todayDate()}.csv`,
      [
        { key: "student", label: "Student" },
        { key: "admission_no", label: "Admission No" },
        { key: "class_name", label: "Class" },
        { key: "term_name", label: "Term" },
        { key: "amount_due", label: "Amount Due" },
        { key: "discount_amount", label: "Discount" },
        { key: "penalty_amount", label: "Penalty" },
        { key: "amount_paid", label: "Paid" },
        { key: "balance", label: "Balance" },
        { key: "due_date", label: "Due Date" },
        { key: "status", label: "Status" },
        { key: "guardian_phone", label: "Guardian Phone" },
      ],
      balances.rows.map((row) => ({
        ...row,
        student: [row.first_name, row.last_name].filter(Boolean).join(" "),
        due_date: row.due_date ? String(row.due_date).slice(0, 10) : "",
      })),
    )
  }

  const paymentConditions = ["p.school_id = ?", "p.status = 'posted'"]
  const paymentParams = [schoolId]
  const termScopedReports = !dateFrom && !dateTo && !balances.setupRequired
  const scopedTermId = Number(req.query.term_id || req.query.termId || (termScopedReports ? balances.session?.termId : 0)) || null
  const scopedTermName = balances.session ? termNameFromSession(balances.session) : null
  if (scopedTermId) {
    paymentConditions.push("(f.term_id = ? OR (f.term_id IS NULL AND f.term_name = ?))")
    paymentParams.push(scopedTermId, scopedTermName)
  }
  if (dateFrom) {
    paymentConditions.push("COALESCE(p.paid_on, DATE(p.paid_at)) >= ?")
    paymentParams.push(dateFrom)
  }
  if (dateTo) {
    paymentConditions.push("COALESCE(p.paid_on, DATE(p.paid_at)) <= ?")
    paymentParams.push(dateTo)
  }

  const invoiceConditions = ["i.school_id = ?"]
  const invoiceParams = [schoolId]
  if (scopedTermId) {
    invoiceConditions.push("(f.term_id = ? OR (f.term_id IS NULL AND f.term_name = ?))")
    invoiceParams.push(scopedTermId, scopedTermName)
  }

  const expenseConditions = ["school_id = ?"]
  const expenseParams = [schoolId]
  if (dateFrom) {
    expenseConditions.push("expense_date >= ?")
    expenseParams.push(dateFrom)
  }
  if (dateTo) {
    expenseConditions.push("expense_date <= ?")
    expenseParams.push(dateTo)
  }

  const [methodBreakdown] = await pool.query(
    `SELECT p.payment_method, COALESCE(SUM(p.amount), 0) AS total, COUNT(*) AS payment_count
     FROM fee_payments p
     JOIN fee_accounts f ON f.id = p.fee_account_id AND f.school_id = p.school_id
     WHERE ${paymentConditions.join(" AND ")}
     GROUP BY payment_method ORDER BY total DESC`,
    paymentParams,
  )
  const [invoiceReport] = await pool.query(
    `SELECT i.status, COALESCE(SUM(i.total_amount), 0) AS total, COUNT(*) AS invoice_count
     FROM finance_invoices i
     JOIN fee_accounts f ON f.id = i.fee_account_id AND f.school_id = i.school_id
     WHERE ${invoiceConditions.join(" AND ")}
     GROUP BY i.status`,
    invoiceParams,
  )
  const [expenseReport] = await pool.query(
    `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS expense_count
     FROM finance_expenses
     WHERE ${expenseConditions.join(" AND ")}
     GROUP BY category ORDER BY total DESC`,
    expenseParams,
  )
  const [dailyCollections] = await pool.query(
    `SELECT COALESCE(p.paid_on, DATE(p.paid_at)) AS report_date, COALESCE(SUM(p.amount), 0) AS collections, COUNT(*) AS payment_count
     FROM fee_payments p
     JOIN fee_accounts f ON f.id = p.fee_account_id AND f.school_id = p.school_id
     WHERE ${paymentConditions.join(" AND ")}
     GROUP BY COALESCE(p.paid_on, DATE(p.paid_at))
     ORDER BY report_date DESC LIMIT 90`,
    paymentParams,
  )
  const [dailyExpenses] = await pool.query(
    `SELECT expense_date AS report_date, COALESCE(SUM(amount), 0) AS expenses, COUNT(*) AS expense_count
     FROM finance_expenses
     WHERE ${expenseConditions.join(" AND ")} AND status IN ('approved', 'paid')
     GROUP BY expense_date
     ORDER BY report_date DESC LIMIT 90`,
    expenseParams,
  )
  const [discountReport] = await pool.query(
    `SELECT status, amount_type, COUNT(*) AS discount_count,
      COALESCE(SUM(amount_value), 0) AS requested_value,
      COALESCE(SUM(applied_amount), 0) AS applied_value
     FROM finance_discounts
     WHERE school_id = ?
     GROUP BY status, amount_type
     ORDER BY status, amount_type`,
    [schoolId],
  )
  const [reversalReport] = await pool.query(
    `SELECT COUNT(*) AS reversal_count, COALESCE(SUM(r.amount), 0) AS reversed_total
     FROM finance_payment_reversals r
     JOIN fee_payments p ON p.id = r.payment_id AND p.school_id = r.school_id
     JOIN fee_accounts f ON f.id = p.fee_account_id AND f.school_id = p.school_id
     WHERE ${paymentConditions.map((condition) => condition.replace(/^p\.status = 'posted'$/, "1 = 1").replace(/^p\.school_id = \?$/, "r.school_id = ?")).join(" AND ")}`,
    paymentParams,
  )

  const cashbook = new Map()
  dailyCollections.forEach((row) => {
    const key = String(row.report_date).slice(0, 10)
    cashbook.set(key, { report_date: key, collections: numberValue(row.collections), expenses: 0, payment_count: Number(row.payment_count || 0), expense_count: 0 })
  })
  dailyExpenses.forEach((row) => {
    const key = String(row.report_date).slice(0, 10)
    const current = cashbook.get(key) || { report_date: key, collections: 0, expenses: 0, payment_count: 0, expense_count: 0 }
    current.expenses = numberValue(row.expenses)
    current.expense_count = Number(row.expense_count || 0)
    cashbook.set(key, current)
  })

  const today = new Date(todayDate())
  const agedBuckets = new Map([
    ["Current", { bucket: "Current", student_count: 0, total: 0 }],
    ["1-30 days", { bucket: "1-30 days", student_count: 0, total: 0 }],
    ["31-60 days", { bucket: "31-60 days", student_count: 0, total: 0 }],
    ["61-90 days", { bucket: "61-90 days", student_count: 0, total: 0 }],
    ["90+ days", { bucket: "90+ days", student_count: 0, total: 0 }],
  ])
  const classMap = new Map()
  balances.rows.forEach((row) => {
    const balance = numberValue(row.balance)
    const expected = numberValue(Number(row.amount_due || 0) + Number(row.penalty_amount || 0) - Number(row.discount_amount || 0))
    const className = row.class_name || "Unassigned"
    const classRow = classMap.get(className) || { class_name: className, expected: 0, collected: 0, outstanding: 0, account_count: 0, collection_rate: 0 }
    classRow.expected = numberValue(classRow.expected + expected)
    classRow.collected = numberValue(classRow.collected + Number(row.amount_paid || 0))
    classRow.outstanding = numberValue(classRow.outstanding + balance)
    classRow.account_count += 1
    classRow.collection_rate = classRow.expected > 0 ? numberValue((classRow.collected / classRow.expected) * 100) : 0
    classMap.set(className, classRow)

    if (balance <= 0) return
    let bucket = "Current"
    if (row.due_date && String(row.due_date).slice(0, 10) < todayDate()) {
      const due = new Date(String(row.due_date).slice(0, 10))
      const days = Math.max(1, Math.floor((today.getTime() - due.getTime()) / 86400000))
      bucket = days > 90 ? "90+ days" : days > 60 ? "61-90 days" : days > 30 ? "31-60 days" : "1-30 days"
    }
    const bucketRow = agedBuckets.get(bucket)
    bucketRow.student_count += 1
    bucketRow.total = numberValue(bucketRow.total + balance)
  })

  const collectedTotal = methodBreakdown.reduce((sum, row) => sum + numberValue(row.total), 0)
  const approvedExpenseTotal = dailyExpenses.reduce((sum, row) => sum + numberValue(row.expenses), 0)
  res.json({
    paymentMethodBreakdown: methodBreakdown,
    invoiceReport,
    expenseReport,
    agedReceivables: [...agedBuckets.values()],
    classCollection: [...classMap.values()].sort((a, b) => b.outstanding - a.outstanding),
    dailyCashbook: [...cashbook.values()]
      .map((row) => ({ ...row, net_cash: numberValue(row.collections - row.expenses) }))
      .sort((a, b) => String(b.report_date).localeCompare(String(a.report_date))),
    defaulters: balances.rows
      .filter((row) => Number(row.balance || 0) > 0 && row.due_date && String(row.due_date).slice(0, 10) < todayDate())
      .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
      .slice(0, 50),
    discountReport,
    reversalReport: reversalReport[0] || { reversal_count: 0, reversed_total: 0 },
    incomeExpenseSummary: {
      collections: numberValue(collectedTotal),
      approvedExpenses: numberValue(approvedExpenseTotal),
      netCash: numberValue(collectedTotal - approvedExpenseTotal),
    },
    balances: balances.rows,
    exports: {
      csv: "/api/fees/reports?format=csv",
      pdf: null,
      print: null,
    },
  })
}

export async function listFinanceAuditLogs(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [logs] = await pool.query(
    `SELECT l.*, u.full_name AS user_name
     FROM finance_audit_logs l
     LEFT JOIN users u ON u.id = l.user_id
     WHERE l.school_id = ?
     ORDER BY l.created_at DESC LIMIT 200`,
    [schoolId],
  )
  res.json({ auditLogs: logs })
}

export async function importBankTransactions(req, res) {
  const schoolId = getScopedSchoolId(req)
  const rawTransactions = Array.isArray(req.body.transactions)
    ? req.body.transactions
    : Array.isArray(req.body.rows)
      ? req.body.rows
      : [req.body]
  const transactions = rawTransactions
    .slice(0, 500)
    .map((rawRow, index) => {
      const row = rawRow || {}
      return {
        rowNumber: index + 1,
        transactionDate: dateValue(row.transaction_date || row.transactionDate || row.date, `transaction ${index + 1} date`, { allowFuture: false }),
        amount: moneyValue(row.amount, `transaction ${index + 1} amount`),
        reference: cleanText(row.reference || row.ref || row.transaction_ref || row.transactionRef, 120),
        payerName: cleanText(row.payer_name || row.payerName || row.description || row.narration, 160),
        channel: cleanText(row.channel || row.source || row.method, 80),
      }
    })
    .filter((row) => row.transactionDate)

  if (!transactions.length) throw new HttpError(400, "Add at least one bank transaction with a date and amount")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    let imported = 0
    let skipped = 0
    const bankTransactions = []
    for (const transaction of transactions) {
      const [[duplicate]] = await connection.query(
        `SELECT id FROM finance_bank_transactions
         WHERE school_id = ? AND transaction_date = ? AND amount = ?
          AND COALESCE(reference, '') = ? AND COALESCE(payer_name, '') = ? AND COALESCE(channel, '') = ?
         LIMIT 1`,
        [
          schoolId,
          transaction.transactionDate,
          transaction.amount,
          transaction.reference || "",
          transaction.payerName || "",
          transaction.channel || "",
        ],
      )
      if (duplicate) {
        skipped += 1
        continue
      }
      const [result] = await connection.query(
        `INSERT INTO finance_bank_transactions (
          school_id, transaction_date, amount, reference, payer_name, channel, imported_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          schoolId,
          transaction.transactionDate,
          transaction.amount,
          transaction.reference,
          transaction.payerName,
          transaction.channel,
          req.user.id,
        ],
      )
      imported += 1
      bankTransactions.push({ id: Number(result.insertId), ...transaction })
    }
    await auditFinance(connection, req, "bank_transactions.imported", "bank_transaction", null, null, { imported, skipped })
    await connection.commit()
    res.status(201).json({ imported, skipped, bankTransactions })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function matchBankTransaction(req, res) {
  const schoolId = getScopedSchoolId(req)
  const bankTransactionId = Number(req.params.id || 0)
  const paymentId = Number(req.body.payment_id || req.body.paymentId || 0)
  if (!bankTransactionId) throw new HttpError(400, "Bank transaction id is required")
  if (!paymentId) throw new HttpError(400, "Payment id is required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[bankTransaction]] = await connection.query(
      "SELECT * FROM finance_bank_transactions WHERE school_id = ? AND id = ? FOR UPDATE",
      [schoolId, bankTransactionId],
    )
    if (!bankTransaction) throw new HttpError(404, "Bank transaction not found")
    if (bankTransaction.status === "matched") throw new HttpError(400, "Bank transaction is already matched")
    if (bankTransaction.status === "ignored") throw new HttpError(400, "Ignored bank transactions must be restored before matching")

    const [[payment]] = await connection.query(
      `SELECT p.*, s.first_name, s.last_name, s.admission_no
       FROM fee_payments p
       JOIN fee_accounts f ON f.id = p.fee_account_id AND f.school_id = p.school_id
       JOIN students s ON s.id = f.student_id AND s.school_id = f.school_id
       WHERE p.school_id = ? AND p.id = ?
       LIMIT 1 FOR UPDATE`,
      [schoolId, paymentId],
    )
    if (!payment) throw new HttpError(404, "Payment not found")
    if (payment.status !== "posted") throw new HttpError(400, "Only posted payments can be reconciled")

    const [[existingMatch]] = await connection.query(
      `SELECT id FROM finance_bank_transactions
       WHERE school_id = ? AND matched_payment_id = ? AND status = 'matched' AND id <> ?
       LIMIT 1 FOR UPDATE`,
      [schoolId, paymentId, bankTransactionId],
    )
    if (existingMatch) throw new HttpError(409, "This payment is already matched to another bank transaction")

    if (!sameMoney(bankTransaction.amount, payment.amount)) {
      const reason = cleanText(req.body.reason, 1000)
      if (!booleanValue(req.body.allow_amount_mismatch || req.body.allowAmountMismatch) || !isOversightUser(req.user) || !reason) {
        throw new HttpError(400, "Bank amount must match the receipt amount unless school leadership records a mismatch reason")
      }
    }

    await connection.query(
      `UPDATE finance_bank_transactions
       SET status = 'matched', matched_payment_id = ?, matched_by = ?, matched_at = CURRENT_TIMESTAMP, ignored_reason = NULL
       WHERE school_id = ? AND id = ?`,
      [paymentId, req.user.id, schoolId, bankTransactionId],
    )
    await auditFinance(connection, req, "bank_transaction.matched", "bank_transaction", bankTransactionId, bankTransaction, {
      paymentId,
      receiptNo: payment.receipt_no,
      amount: payment.amount,
    })
    await connection.commit()
    res.json({ ok: true, bank_transaction_id: bankTransactionId, payment_id: paymentId })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function transitionBankTransaction(req, res) {
  const schoolId = getScopedSchoolId(req)
  const bankTransactionId = Number(req.params.id || 0)
  const action = String(req.params.action || "").toLowerCase()
  const reason = cleanText(req.body.reason, 1000)
  if (!bankTransactionId) throw new HttpError(400, "Bank transaction id is required")
  if (!["unmatch", "ignore"].includes(action)) throw new HttpError(400, "Bank transaction action is not supported")
  if (!reason) throw new HttpError(400, "Reason is required")
  if (action === "ignore" && !isOversightUser(req.user)) {
    throw new HttpError(403, "Only school leadership can ignore a bank transaction")
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[bankTransaction]] = await connection.query(
      "SELECT * FROM finance_bank_transactions WHERE school_id = ? AND id = ? FOR UPDATE",
      [schoolId, bankTransactionId],
    )
    if (!bankTransaction) throw new HttpError(404, "Bank transaction not found")

    if (action === "unmatch") {
      if (bankTransaction.status !== "matched") throw new HttpError(400, "Only matched bank transactions can be unmatched")
      await connection.query(
        `UPDATE finance_bank_transactions
         SET status = 'unmatched', matched_payment_id = NULL, matched_by = NULL, matched_at = NULL, ignored_reason = NULL
         WHERE school_id = ? AND id = ?`,
        [schoolId, bankTransactionId],
      )
    } else {
      if (bankTransaction.status === "matched") throw new HttpError(400, "Unmatch this bank transaction before ignoring it")
      await connection.query(
        `UPDATE finance_bank_transactions
         SET status = 'ignored', matched_payment_id = NULL, matched_by = NULL, matched_at = NULL, ignored_reason = ?
         WHERE school_id = ? AND id = ?`,
        [reason, schoolId, bankTransactionId],
      )
    }

    await auditFinance(connection, req, `bank_transaction.${action}`, "bank_transaction", bankTransactionId, bankTransaction, { reason })
    await connection.commit()
    res.json({ ok: true })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listReconciliation(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [unreconciledPayments] = await pool.query(
    `SELECT p.*, s.first_name, s.last_name, s.admission_no
     FROM fee_payments p
     JOIN fee_accounts f ON f.id = p.fee_account_id AND f.school_id = p.school_id
     JOIN students s ON s.id = f.student_id AND s.school_id = f.school_id
     LEFT JOIN finance_bank_transactions bt ON bt.matched_payment_id = p.id AND bt.school_id = p.school_id AND bt.status = 'matched'
     WHERE p.school_id = ? AND p.status = 'posted' AND bt.id IS NULL
     ORDER BY COALESCE(p.paid_on, DATE(p.paid_at)) DESC, p.id DESC LIMIT 200`,
    [schoolId],
  )
  const [bankTransactions] = await pool.query(
    `SELECT bt.*, p.receipt_no AS matched_receipt_no, p.amount AS matched_payment_amount,
      s.first_name AS matched_first_name, s.last_name AS matched_last_name, s.admission_no AS matched_admission_no,
      importer.full_name AS imported_by_name, matcher.full_name AS matched_by_name
     FROM finance_bank_transactions bt
     LEFT JOIN fee_payments p ON p.id = bt.matched_payment_id AND p.school_id = bt.school_id
     LEFT JOIN fee_accounts f ON f.id = p.fee_account_id AND f.school_id = p.school_id
     LEFT JOIN students s ON s.id = f.student_id AND s.school_id = f.school_id
     LEFT JOIN users importer ON importer.id = bt.imported_by
     LEFT JOIN users matcher ON matcher.id = bt.matched_by
     WHERE bt.school_id = ?
     ORDER BY bt.transaction_date DESC, bt.id DESC LIMIT 200`,
    [schoolId],
  )
  res.json({ unreconciledPayments, bankTransactions })
}
