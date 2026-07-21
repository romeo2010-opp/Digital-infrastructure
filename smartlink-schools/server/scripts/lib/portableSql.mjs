export function sanitizeSql(sql) {
  return String(sql || "")
    .replace(/^\s*CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+smartlink_schools\b[^;]*;\s*/gim, "")
    .replace(/^\s*USE\s+smartlink_schools\s*;\s*/gim, "")
}

function scanDelimited(value, delimiter) {
  const parts = []
  let current = ""
  let quote = null
  let lineComment = false
  let blockComment = false
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    const next = value[index + 1]
    if (lineComment) {
      if (character === "\n") lineComment = false
      continue
    }
    if (blockComment) {
      if (character === "*" && next === "/") { blockComment = false; index += 1 }
      continue
    }
    if (quote) {
      current += character
      if (character === "\\" && quote !== "`" && next) {
        current += next
        index += 1
      } else if (character === quote) {
        if (next === quote && quote !== "`") { current += next; index += 1 }
        else quote = null
      }
      continue
    }
    if ((character === "-" && next === "-" && /\s/.test(value[index + 2] || "")) || character === "#") {
      current += " "
      lineComment = true
      if (character === "-") index += 1
      continue
    }
    if (character === "/" && next === "*") { current += " "; blockComment = true; index += 1; continue }
    if (["'", '"', "`"].includes(character)) { quote = character; current += character; continue }
    if (character === "(") depth += 1
    else if (character === ")") depth = Math.max(0, depth - 1)
    if (character === delimiter && depth === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ""
    } else current += character
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

export function splitSqlStatements(sql) {
  return scanDelimited(sanitizeSql(sql), ";")
}

export function expandAlterStatement(statement) {
  const match = String(statement).trim().match(/^ALTER\s+TABLE\s+(`?[A-Za-z_][\w]*`?(?:\.`?[A-Za-z_][\w]*`?)?)\s+([\s\S]+)$/i)
  if (!match) return [String(statement).trim()]
  const [, table, body] = match
  const actions = scanDelimited(body, ",")
  return actions.length > 1 ? actions.map((action) => `ALTER TABLE ${table} ${action}`) : [String(statement).trim()]
}

export function portableStatement(statement, dialect = "mysql") {
  const original = String(statement).trim()
  const ignoreCodes = new Set()
  let sql = original
  if (/^ALTER\s+TABLE\b[\s\S]*\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i.test(original)) ignoreCodes.add("ER_DUP_FIELDNAME")
  if (/\bADD\s+(?:UNIQUE\s+)?(?:KEY|INDEX)\s+IF\s+NOT\s+EXISTS\b/i.test(original) || /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/i.test(original)) ignoreCodes.add("ER_DUP_KEYNAME")
  if (/\bDROP\s+(?:KEY|INDEX)\s+IF\s+EXISTS\b/i.test(original) || /^DROP\s+INDEX\s+IF\s+EXISTS\b/i.test(original)) {
    ignoreCodes.add("ER_CANT_DROP_FIELD_OR_KEY")
    ignoreCodes.add("ER_BAD_FIELD_ERROR")
  }
  if (/\bDROP\s+FOREIGN\s+KEY\s+IF\s+EXISTS\b/i.test(original)) {
    ignoreCodes.add("ER_CANT_DROP_FIELD_OR_KEY")
    ignoreCodes.add("ER_BAD_FIELD_ERROR")
  }
  if (/\bADD\s+CONSTRAINT\b/i.test(original)) {
    ignoreCodes.add("ER_FK_DUP_NAME")
    ignoreCodes.add("ER_DUP_KEYNAME")
  }
  if (dialect === "mysql") {
    sql = sql
      .replace(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/gi, "ADD COLUMN")
      .replace(/\bADD\s+((?:UNIQUE\s+)?(?:KEY|INDEX))\s+IF\s+NOT\s+EXISTS\b/gi, "ADD $1")
      .replace(/\bDROP\s+((?:KEY|INDEX))\s+IF\s+EXISTS\b/gi, "DROP $1")
      .replace(/\bDROP\s+FOREIGN\s+KEY\s+IF\s+EXISTS\b/gi, "DROP FOREIGN KEY")
      .replace(/^(\s*CREATE\s+(?:UNIQUE\s+)?INDEX)\s+IF\s+NOT\s+EXISTS\b/i, "$1")
      .replace(/^(\s*DROP\s+INDEX)\s+IF\s+EXISTS\b/i, "$1")
  }
  return { original, sql, ignoreCodes }
}

export async function databaseDialect(connection) {
  const [[identity]] = await connection.query("SELECT VERSION() server_version, @@version_comment version_comment")
  const signature = `${identity?.server_version || ""} ${identity?.version_comment || ""}`.toLowerCase()
  return { dialect: signature.includes("mariadb") ? "mariadb" : "mysql", identity }
}

export async function applyPortableSql(connection, sql, options = {}) {
  const dialect = options.dialect || (await databaseDialect(connection)).dialect
  const log = typeof options.log === "function" ? options.log : () => {}
  const statements = splitSqlStatements(sql).flatMap(expandAlterStatement)
  const result = { dialect, applied: 0, skipped: 0, statements: statements.length }
  for (let index = 0; index < statements.length; index += 1) {
    const portable = portableStatement(statements[index], dialect)
    if (!portable.sql || /^USE\s+/i.test(portable.sql)) continue
    try {
      await connection.query(portable.sql)
      result.applied += 1
    } catch (error) {
      if (portable.ignoreCodes.has(error?.code)) {
        result.skipped += 1
        log(`Skipped existing migration object (${error.code}) in statement ${index + 1}.`)
        continue
      }
      error.message = `${options.source || "SQL migration"} statement ${index + 1}/${statements.length} failed: ${error.message}`
      throw error
    }
  }
  return result
}
