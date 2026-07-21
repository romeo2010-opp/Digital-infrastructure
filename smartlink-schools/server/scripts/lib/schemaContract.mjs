import { splitSqlStatements } from "./portableSql.mjs"

const columnTypeNames = new Set([
  "bigint", "int", "integer", "smallint", "tinyint", "mediumint",
  "decimal", "numeric", "double", "float", "real", "boolean", "bool",
  "char", "varchar", "text", "tinytext", "mediumtext", "longtext",
  "binary", "varbinary", "blob", "tinyblob", "mediumblob", "longblob",
  "date", "datetime", "timestamp", "time", "year", "json", "enum", "set",
])

function cleanIdentifier(value) {
  return String(value || "")
    .trim()
    .split(".")
    .pop()
    .replace(/^`|`$/g, "")
    .toLowerCase()
}

export function splitContractList(value) {
  const parts = []
  let current = ""
  let quote = null
  let depth = 0
  for (let index = 0; index < String(value || "").length; index += 1) {
    const character = value[index]
    const next = value[index + 1]
    if (quote) {
      current += character
      if (character === "\\" && quote !== "`" && next) {
        current += next
        index += 1
      } else if (character === quote) {
        if (next === quote && quote !== "`") {
          current += next
          index += 1
        } else quote = null
      }
      continue
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character
      current += character
      continue
    }
    if (character === "(") depth += 1
    else if (character === ")") depth = Math.max(0, depth - 1)
    if (character === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ""
    } else current += character
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function balancedOuterParentheses(value) {
  if (!value.startsWith("(") || !value.endsWith(")")) return false
  let quote = null
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    const next = value[index + 1]
    if (quote) {
      if (character === "\\" && next) index += 1
      else if (character === quote) {
        if (next === quote) index += 1
        else quote = null
      }
      continue
    }
    if (["'", '"', "`"].includes(character)) { quote = character; continue }
    if (character === "(") depth += 1
    else if (character === ")") depth -= 1
    if (depth === 0 && index < value.length - 1) return false
  }
  return depth === 0
}

export function normalizeColumnType(value) {
  let normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)/g, ")")
    .replace(/\s*,\s*/g, ",")
    .replace(/\binteger\b/g, "int")
    .replace(/\bnumeric\b/g, "decimal")
    .replace(/\b(?:boolean|bool)\b/g, "tinyint(1)")
    .replace(/\bdouble precision\b/g, "double")
  normalized = normalized.replace(/\s+(unsigned|zerofill)/g, " $1")
  return normalized
}

function unquoteDefault(value) {
  if (value.length < 2) return value
  const quote = value[0]
  if (!["'", '"'].includes(quote) || value.at(-1) !== quote) return value
  return value.slice(1, -1)
    .replaceAll(`${quote}${quote}`, quote)
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
}

export function normalizeColumnDefault(value) {
  if (value === null || value === undefined) return null
  let normalized = Buffer.isBuffer(value) ? value.toString("utf8") : String(value)
  normalized = normalized.trim()
  if (!normalized || /^null$/i.test(normalized)) return null
  if (["'", '"'].includes(normalized[0]) && normalized.at(-1) === normalized[0]) {
    return unquoteDefault(normalized)
  }
  while (balancedOuterParentheses(normalized)) normalized = normalized.slice(1, -1).trim()
  if (/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    const sign = normalized.startsWith("-") ? "-" : ""
    const unsigned = normalized.replace(/^[+-]/, "")
    const [whole, fraction = ""] = unsigned.split(".")
    const cleanWhole = whole.replace(/^0+(?=\d)/, "") || "0"
    const cleanFraction = fraction.replace(/0+$/, "")
    return `${sign}${cleanWhole}${cleanFraction ? `.${cleanFraction}` : ""}`
  }
  return normalized
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^current_timestamp\(\)$/i, "current_timestamp")
    .replace(/^current_date\(\)$/i, "current_date")
    .replace(/^current_time\(\)$/i, "current_time")
}

function readParenthesized(value, startIndex) {
  let quote = null
  let depth = 0
  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index]
    const next = value[index + 1]
    if (quote) {
      if (character === "\\" && next) index += 1
      else if (character === quote) {
        if (next === quote) index += 1
        else quote = null
      }
      continue
    }
    if (["'", '"'].includes(character)) { quote = character; continue }
    if (character === "(") depth += 1
    else if (character === ")") {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return value.length
}

function parseTypeAndRemainder(value) {
  const text = String(value || "").trim()
  const baseMatch = text.match(/^([A-Za-z]+)(?:\s+(PRECISION))?/i)
  if (!baseMatch || !columnTypeNames.has(baseMatch[1].toLowerCase())) return null
  let end = baseMatch[0].length
  while (/\s/.test(text[end] || "")) end += 1
  if (text[end] === "(") end = readParenthesized(text, end)
  let type = text.slice(0, end).trim()
  let remainder = text.slice(end).trim()
  for (const modifier of ["unsigned", "zerofill"]) {
    const match = remainder.match(new RegExp(`^${modifier}\\b`, "i"))
    if (match) {
      type += ` ${modifier}`
      remainder = remainder.slice(match[0].length).trim()
    }
  }
  return { type: normalizeColumnType(type), remainder }
}

function readDefaultToken(remainder) {
  const match = remainder.match(/\bDEFAULT\b/i)
  if (!match) return null
  const value = remainder.slice(match.index + match[0].length).trim()
  if (!value) return null
  if (["'", '"'].includes(value[0])) {
    const quote = value[0]
    for (let index = 1; index < value.length; index += 1) {
      if (value[index] === "\\") { index += 1; continue }
      if (value[index] === quote) {
        if (value[index + 1] === quote) { index += 1; continue }
        return value.slice(0, index + 1)
      }
    }
    return value
  }
  if (value[0] === "(") return value.slice(0, readParenthesized(value, 0))
  return value.match(/^[^\s,]+/)?.[0] || null
}

function parseColumnDefinition(entry, source) {
  const match = String(entry || "").trim().match(/^`?([A-Za-z_][\w]*)`?\s+([\s\S]+)$/)
  if (!match) return null
  const keyword = match[1].toLowerCase()
  if (["primary", "unique", "key", "index", "constraint", "foreign", "check", "fulltext", "spatial"].includes(keyword)) return null
  const parsedType = parseTypeAndRemainder(match[2])
  if (!parsedType) return null
  const inlinePrimary = /\bPRIMARY\s+KEY\b/i.test(parsedType.remainder)
  return {
    name: keyword,
    type: parsedType.type,
    nullable: inlinePrimary ? false : !/\bNOT\s+NULL\b/i.test(parsedType.remainder),
    default: normalizeColumnDefault(readDefaultToken(parsedType.remainder)),
    inlinePrimary,
    inlineUnique: /\bUNIQUE(?:\s+KEY)?\b/i.test(parsedType.remainder),
    source,
  }
}

function parseIndexColumns(value) {
  return splitContractList(value).map((part) => {
    const text = part.trim()
    const identifier = text.match(/^`?([A-Za-z_][\w]*)`?(?:\s*\(\s*(\d+)\s*\))?(?:\s+(ASC|DESC))?$/i)
    if (identifier) {
      return {
        column: identifier[1].toLowerCase(),
        subPart: identifier[2] ? Number(identifier[2]) : null,
        direction: identifier[3] ? identifier[3].toUpperCase() : null,
      }
    }
    return { expression: text.replace(/\s+/g, " ").toLowerCase(), column: null, subPart: null, direction: null }
  })
}

function parseIndexDefinition(value, source, fallbackName = null) {
  const text = String(value || "").trim().replace(/^ADD\s+/i, "")
  let match = text.match(/^PRIMARY\s+KEY(?:\s+USING\s+\w+)?\s*\(([\s\S]+)\)(?:\s+USING\s+\w+)?$/i)
  if (match) return { name: "primary", unique: true, columns: parseIndexColumns(match[1]), source }
  match = text.match(/^UNIQUE\s+(?:KEY|INDEX)?\s*(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z_][\w]*)`?\s*\(([\s\S]+)\)(?:\s+USING\s+\w+)?$/i)
  if (match) return { name: match[1].toLowerCase(), unique: true, columns: parseIndexColumns(match[2]), source }
  match = text.match(/^(?:KEY|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z_][\w]*)`?\s*\(([\s\S]+)\)(?:\s+USING\s+\w+)?$/i)
  if (match) return { name: match[1].toLowerCase(), unique: false, columns: parseIndexColumns(match[2]), source }
  match = text.match(/^CONSTRAINT\s+`?([A-Za-z_][\w]*)`?\s+UNIQUE\s*\(([\s\S]+)\)$/i)
  if (match) return { name: match[1].toLowerCase(), unique: true, columns: parseIndexColumns(match[2]), source }
  if (fallbackName) return { name: fallbackName.toLowerCase(), unique: true, columns: [{ column: fallbackName.toLowerCase(), subPart: null, direction: null }], source }
  return null
}

function normalizeReferentialRule(value) {
  const rule = String(value || "RESTRICT").trim().replace(/\s+/g, " ").toUpperCase()
  return rule === "NO ACTION" ? "RESTRICT" : rule
}

function parseForeignKeyDefinition(value, source) {
  const text = String(value || "").trim().replace(/^ADD\s+/i, "")
  const match = text.match(/^(?:CONSTRAINT\s+`?([A-Za-z_][\w]*)`?\s+)?FOREIGN\s+KEY\s*\(([\s\S]+?)\)\s+REFERENCES\s+(?:`?[A-Za-z_][\w]*`?\.)?`?([A-Za-z_][\w]*)`?\s*\(([\s\S]+?)\)([\s\S]*)$/i)
  if (!match) return null
  const columns = parseIndexColumns(match[2]).map((item) => item.column).filter(Boolean)
  const referencedColumns = parseIndexColumns(match[4]).map((item) => item.column).filter(Boolean)
  const tail = match[5] || ""
  const deleteRule = tail.match(/\bON\s+DELETE\s+(RESTRICT|CASCADE|SET\s+NULL|NO\s+ACTION|SET\s+DEFAULT)\b/i)?.[1]
  const updateRule = tail.match(/\bON\s+UPDATE\s+(RESTRICT|CASCADE|SET\s+NULL|NO\s+ACTION|SET\s+DEFAULT)\b/i)?.[1]
  return {
    name: match[1]?.toLowerCase() || null,
    columns,
    referencedTable: match[3].toLowerCase(),
    referencedColumns,
    onDelete: normalizeReferentialRule(deleteRule),
    onUpdate: normalizeReferentialRule(updateRule),
    source,
  }
}

function newTableContract(table) {
  return {
    table: cleanIdentifier(table),
    defined: false,
    sources: new Set(),
    columns: new Map(),
    indexes: new Map(),
    foreignKeys: new Map(),
  }
}

function tableContract(expected, table) {
  const key = cleanIdentifier(table)
  if (!expected.has(key)) expected.set(key, newTableContract(key))
  return expected.get(key)
}

function mergeSources(previous, source) {
  const sources = new Set(previous?.sources || [])
  if (previous?.source) sources.add(previous.source)
  if (source) sources.add(source)
  return sources
}

function setColumn(contract, parsed, source, options = {}) {
  const current = contract.columns.get(parsed.name)
  if (options.ifNotExists && current) {
    current.sources = mergeSources(current, source)
    return
  }
  contract.columns.set(parsed.name, { ...parsed, sources: mergeSources(current, source) })
  if (parsed.inlinePrimary) {
    contract.indexes.set("primary", {
      name: "primary", unique: true,
      columns: [{ column: parsed.name, subPart: null, direction: null }],
      sources: mergeSources(contract.indexes.get("primary"), source),
    })
  }
  if (parsed.inlineUnique) {
    contract.indexes.set(parsed.name, {
      name: parsed.name, unique: true,
      columns: [{ column: parsed.name, subPart: null, direction: null }],
      sources: mergeSources(contract.indexes.get(parsed.name), source),
    })
  }
}

function setIndex(contract, parsed, source, options = {}) {
  if (!parsed) return
  const current = contract.indexes.get(parsed.name)
  if (options.ifNotExists && current) {
    current.sources = mergeSources(current, source)
    return
  }
  contract.indexes.set(parsed.name, { ...parsed, sources: mergeSources(current, source) })
  if (parsed.name === "primary") {
    for (const part of parsed.columns) {
      const column = part.column ? contract.columns.get(part.column) : null
      if (column) column.nullable = false
    }
  }
}

function foreignKeyKey(parsed) {
  return parsed.name || `__unnamed__:${parsed.columns.join(",")}:${parsed.referencedTable}:${parsed.referencedColumns.join(",")}`
}

function setForeignKey(contract, parsed, source) {
  if (!parsed) return
  const key = foreignKeyKey(parsed)
  const current = contract.foreignKeys.get(key)
  if (current) {
    current.sources = mergeSources(current, source)
    return
  }
  contract.foreignKeys.set(key, { ...parsed, sources: mergeSources(current, source) })
}

function findClosingTableParen(statement, openIndex) {
  let quote = null
  let depth = 0
  for (let index = openIndex; index < statement.length; index += 1) {
    const character = statement[index]
    const next = statement[index + 1]
    if (quote) {
      if (character === "\\" && next) index += 1
      else if (character === quote) {
        if (next === quote) index += 1
        else quote = null
      }
      continue
    }
    if (["'", '"', "`"].includes(character)) { quote = character; continue }
    if (character === "(") depth += 1
    else if (character === ")") {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function applyCreateTable(expected, statement, source, warnings) {
  const match = statement.match(/^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(?:`?[A-Za-z_][\w]*`?\.)?`?([A-Za-z_][\w]*)`?\s*\(/i)
  if (!match) return false
  const contract = tableContract(expected, match[2])
  contract.sources.add(source)
  // A second CREATE for an existing table would either be skipped by IF NOT
  // EXISTS/the migration guard or fail; it must not replace the established
  // contract with an older bootstrap definition.
  if (contract.defined) return true
  const openIndex = statement.indexOf("(", match.index + match[0].length - 1)
  const closeIndex = findClosingTableParen(statement, openIndex)
  if (closeIndex < 0) {
    warnings.push({ source, statement: statement.slice(0, 120), reason: "CREATE TABLE body could not be parsed" })
    return true
  }
  contract.defined = true
  for (const entry of splitContractList(statement.slice(openIndex + 1, closeIndex))) {
    const foreignKey = parseForeignKeyDefinition(entry, source)
    if (foreignKey) { setForeignKey(contract, foreignKey, source); continue }
    const index = parseIndexDefinition(entry, source)
    if (index) { setIndex(contract, index, source); continue }
    const column = parseColumnDefinition(entry, source)
    if (column) setColumn(contract, column, source)
  }
  return true
}

function applyAlterAction(contract, action, source, warnings) {
  const text = action.trim().replace(/,+\s*$/, "")
  let match = text.match(/^ADD\s+(?:COLUMN\s+)?(IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i)
  if (match) {
    const definition = match[2]
    const foreignKey = parseForeignKeyDefinition(`ADD ${definition}`, source)
    if (foreignKey) { setForeignKey(contract, foreignKey, source); return }
    const index = parseIndexDefinition(`ADD ${definition}`, source)
    if (index) { setIndex(contract, index, source, { ifNotExists: true }); return }
    const column = parseColumnDefinition(definition, source)
    if (column) { setColumn(contract, column, source, { ifNotExists: true }); return }
  }
  match = text.match(/^MODIFY\s+(?:COLUMN\s+)?([\s\S]+)$/i)
  if (match) {
    const column = parseColumnDefinition(match[1], source)
    if (column) setColumn(contract, column, source)
    else warnings.push({ source, table: contract.table, statement: text.slice(0, 160), reason: "MODIFY COLUMN could not be parsed" })
    return
  }
  match = text.match(/^CHANGE\s+(?:COLUMN\s+)?`?([A-Za-z_][\w]*)`?\s+([\s\S]+)$/i)
  if (match) {
    const column = parseColumnDefinition(match[2], source)
    if (column) {
      contract.columns.delete(match[1].toLowerCase())
      setColumn(contract, column, source)
    }
    return
  }
  match = text.match(/^RENAME\s+COLUMN\s+`?([A-Za-z_][\w]*)`?\s+TO\s+`?([A-Za-z_][\w]*)`?$/i)
  if (match) {
    const previous = contract.columns.get(match[1].toLowerCase())
    if (previous) {
      contract.columns.delete(match[1].toLowerCase())
      contract.columns.set(match[2].toLowerCase(), { ...previous, name: match[2].toLowerCase(), sources: mergeSources(previous, source) })
    }
    return
  }
  match = text.match(/^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?`?([A-Za-z_][\w]*)`?/i)
  if (match) { contract.columns.delete(match[1].toLowerCase()); return }
  if (/^DROP\s+PRIMARY\s+KEY\b/i.test(text)) { contract.indexes.delete("primary"); return }
  match = text.match(/^DROP\s+(?:KEY|INDEX)\s+(?:IF\s+EXISTS\s+)?`?([A-Za-z_][\w]*)`?/i)
  if (match) { contract.indexes.delete(match[1].toLowerCase()); return }
  match = text.match(/^DROP\s+FOREIGN\s+KEY\s+`?([A-Za-z_][\w]*)`?/i)
  if (match) { contract.foreignKeys.delete(match[1].toLowerCase()); return }
  match = text.match(/^ALTER\s+COLUMN\s+`?([A-Za-z_][\w]*)`?\s+SET\s+DEFAULT\s+([\s\S]+)$/i)
  if (match) {
    const column = contract.columns.get(match[1].toLowerCase())
    if (column) column.default = normalizeColumnDefault(match[2])
    return
  }
  match = text.match(/^ALTER\s+COLUMN\s+`?([A-Za-z_][\w]*)`?\s+DROP\s+DEFAULT$/i)
  if (match) {
    const column = contract.columns.get(match[1].toLowerCase())
    if (column) column.default = null
  }
}

function applyAlterTable(expected, statement, source, warnings) {
  const match = statement.match(/^ALTER\s+TABLE\s+(?:`?[A-Za-z_][\w]*`?\.)?`?([A-Za-z_][\w]*)`?\s+([\s\S]+)$/i)
  if (!match) return false
  const contract = tableContract(expected, match[1])
  contract.sources.add(source)
  for (const action of splitContractList(match[2])) applyAlterAction(contract, action, source, warnings)
  return true
}

function applyCreateIndex(expected, statement, source) {
  const match = statement.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z_][\w]*)`?\s+ON\s+(?:`?[A-Za-z_][\w]*`?\.)?`?([A-Za-z_][\w]*)`?\s*\(([\s\S]+)\)/i)
  if (!match) return false
  const contract = tableContract(expected, match[3])
  contract.sources.add(source)
  setIndex(contract, {
    name: match[2].toLowerCase(), unique: Boolean(match[1]), columns: parseIndexColumns(match[4]), source,
  }, source, { ifNotExists: true })
  return true
}

function applyDropIndex(expected, statement) {
  const match = statement.match(/^DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?`?([A-Za-z_][\w]*)`?\s+ON\s+(?:`?[A-Za-z_][\w]*`?\.)?`?([A-Za-z_][\w]*)`?/i)
  if (!match) return false
  tableContract(expected, match[2]).indexes.delete(match[1].toLowerCase())
  return true
}

function embeddedSchemaStatements(content) {
  const statements = []
  for (const quote of ['"', "'", "`"]) {
    let current = ""
    let inside = false
    for (let index = 0; index < content.length; index += 1) {
      const character = content[index]
      if (!inside) {
        if (character === quote) { inside = true; current = "" }
        continue
      }
      if (character === "\\" && content[index + 1]) {
        current += content[index + 1]
        index += 1
        continue
      }
      if (character === quote) {
        inside = false
        const value = current.trim()
        if (/^(?:CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX)\b/i.test(value)) statements.push(value.replace(/;\s*$/, ""))
      } else current += character
    }
  }
  return statements
}

export function buildSchemaContracts(files = []) {
  const expected = new Map()
  const warnings = []
  for (const file of files) {
    const source = String(file?.source || "unknown")
    // splitSqlStatements is comment-aware. Keeping the raw text here matters because
    // defaults and enum labels may legitimately contain comment-looking characters.
    const content = String(file?.content || "")
    const direct = splitSqlStatements(content)
    const embedded = embeddedSchemaStatements(content)
    const seen = new Set()
    for (const statement of [...direct, ...embedded]) {
      const sql = String(statement || "").trim()
      if (!sql || seen.has(sql)) continue
      seen.add(sql)
      if (applyCreateTable(expected, sql, source, warnings)) continue
      if (applyAlterTable(expected, sql, source, warnings)) continue
      if (applyCreateIndex(expected, sql, source)) continue
      applyDropIndex(expected, sql)
    }
  }
  return { expected, warnings }
}

function sourcesArray(item) {
  return [...(item?.sources || [])].sort()
}

function actualIndexContracts(rows = []) {
  const map = new Map()
  for (const row of rows) {
    const table = cleanIdentifier(row.table_name)
    const name = cleanIdentifier(row.index_name)
    const key = `${table}:${name}`
    if (!map.has(key)) map.set(key, { table, name, unique: Number(row.non_unique) === 0, columns: [] })
    map.get(key).columns.push({
      sequence: Number(row.seq_in_index || 0),
      column: row.column_name ? cleanIdentifier(row.column_name) : null,
      expression: row.expression ? String(row.expression).replace(/\s+/g, " ").toLowerCase() : null,
      subPart: row.sub_part === null || row.sub_part === undefined ? null : Number(row.sub_part),
      direction: String(row.collation || "").toUpperCase() === "D" ? "DESC" : "ASC",
    })
  }
  for (const index of map.values()) index.columns.sort((a, b) => a.sequence - b.sequence)
  return map
}

function actualForeignKeyContracts(keyRows = [], ruleRows = []) {
  const rules = new Map(ruleRows.map((row) => [
    `${cleanIdentifier(row.table_name)}:${cleanIdentifier(row.constraint_name)}`,
    { onDelete: normalizeReferentialRule(row.delete_rule), onUpdate: normalizeReferentialRule(row.update_rule) },
  ]))
  const map = new Map()
  for (const row of keyRows) {
    if (!row.referenced_table_name) continue
    const table = cleanIdentifier(row.table_name)
    const name = cleanIdentifier(row.constraint_name)
    const key = `${table}:${name}`
    if (!map.has(key)) map.set(key, {
      table, name, columns: [], referencedTable: cleanIdentifier(row.referenced_table_name), referencedColumns: [],
      ...(rules.get(key) || { onDelete: "RESTRICT", onUpdate: "RESTRICT" }),
    })
    const foreignKey = map.get(key)
    foreignKey.columns.push({ sequence: Number(row.ordinal_position || 0), column: cleanIdentifier(row.column_name) })
    foreignKey.referencedColumns.push({ sequence: Number(row.ordinal_position || 0), column: cleanIdentifier(row.referenced_column_name) })
  }
  for (const foreignKey of map.values()) {
    foreignKey.columns.sort((a, b) => a.sequence - b.sequence)
    foreignKey.referencedColumns.sort((a, b) => a.sequence - b.sequence)
    foreignKey.columns = foreignKey.columns.map((item) => item.column)
    foreignKey.referencedColumns = foreignKey.referencedColumns.map((item) => item.column)
  }
  return map
}

function columnSummary(column) {
  return { type: column.type, nullable: Boolean(column.nullable), default: column.default }
}

function indexSummary(index) {
  return {
    unique: Boolean(index.unique),
    columns: index.columns.map((item) => ({
      column: item.column || null,
      ...(item.expression ? { expression: item.expression } : {}),
      ...(item.subPart ? { sub_part: item.subPart } : {}),
      ...(item.direction ? { direction: item.direction } : {}),
    })),
  }
}

function foreignKeySummary(foreignKey) {
  return {
    columns: foreignKey.columns,
    referenced_table: foreignKey.referencedTable,
    referenced_columns: foreignKey.referencedColumns,
    on_delete: foreignKey.onDelete,
    on_update: foreignKey.onUpdate,
  }
}

function sameIndex(expected, actual) {
  if (Boolean(expected.unique) !== Boolean(actual.unique) || expected.columns.length !== actual.columns.length) return false
  return expected.columns.every((part, index) => {
    const actualPart = actual.columns[index]
    if ((part.column || null) !== (actualPart.column || null)) return false
    if (part.expression && part.expression !== actualPart.expression) return false
    if (part.subPart !== null && part.subPart !== actualPart.subPart) return false
    if (part.direction && part.direction !== actualPart.direction) return false
    return true
  })
}

function sameForeignKey(expected, actual) {
  return expected.columns.join(",") === actual.columns.join(",")
    && expected.referencedTable === actual.referencedTable
    && expected.referencedColumns.join(",") === actual.referencedColumns.join(",")
    && expected.onDelete === actual.onDelete
    && expected.onUpdate === actual.onUpdate
}

export function compareSchemaContracts(expected, metadata = {}) {
  const actualTables = new Set((metadata.tables || []).map((row) => cleanIdentifier(row.table_name)))
  const actualColumns = new Map()
  for (const row of metadata.columns || []) {
    const table = cleanIdentifier(row.table_name)
    const name = cleanIdentifier(row.column_name)
    if (!actualColumns.has(table)) actualColumns.set(table, new Map())
    actualColumns.get(table).set(name, {
      name,
      type: normalizeColumnType(row.column_type),
      nullable: String(row.is_nullable || "").toUpperCase() === "YES",
      default: normalizeColumnDefault(row.column_default),
    })
  }
  const actualIndexes = actualIndexContracts(metadata.indexes)
  const actualForeignKeys = actualForeignKeyContracts(metadata.foreignKeys, metadata.referentialRules)
  const missingTables = []
  const missingColumns = []
  const columnMismatches = []
  const missingIndexes = []
  const indexMismatches = []
  const missingForeignKeys = []
  const foreignKeyMismatches = []

  for (const contract of expected.values()) {
    if (!contract.defined && !contract.columns.size) continue
    const tableSources = sourcesArray(contract)
    if (!actualTables.has(contract.table)) {
      missingTables.push({ table: contract.table, sources: tableSources })
      continue
    }
    const columns = actualColumns.get(contract.table) || new Map()
    for (const [name, expectedColumn] of contract.columns) {
      const actualColumn = columns.get(name)
      if (!actualColumn) {
        missingColumns.push({ table: contract.table, column: name, sources: sourcesArray(expectedColumn) })
        continue
      }
      const expectedSummary = columnSummary(expectedColumn)
      const actualSummary = columnSummary(actualColumn)
      const differences = Object.keys(expectedSummary).filter((key) => expectedSummary[key] !== actualSummary[key])
      if (differences.length) columnMismatches.push({
        table: contract.table, column: name, differences,
        expected: expectedSummary, actual: actualSummary, sources: sourcesArray(expectedColumn),
      })
    }
    for (const [name, expectedIndex] of contract.indexes) {
      const actualIndex = actualIndexes.get(`${contract.table}:${name}`)
      if (!actualIndex) {
        missingIndexes.push({ table: contract.table, index: name, expected: indexSummary(expectedIndex), sources: sourcesArray(expectedIndex) })
      } else if (!sameIndex(expectedIndex, actualIndex)) {
        indexMismatches.push({
          table: contract.table, index: name,
          expected: indexSummary(expectedIndex), actual: indexSummary(actualIndex), sources: sourcesArray(expectedIndex),
        })
      }
    }
    for (const expectedForeignKey of contract.foreignKeys.values()) {
      let actualForeignKey = expectedForeignKey.name
        ? actualForeignKeys.get(`${contract.table}:${expectedForeignKey.name}`)
        : null
      if (!actualForeignKey && !expectedForeignKey.name) {
        actualForeignKey = [...actualForeignKeys.values()].find((candidate) => candidate.table === contract.table && sameForeignKey(expectedForeignKey, candidate))
      }
      const label = expectedForeignKey.name || foreignKeyKey(expectedForeignKey)
      if (!actualForeignKey) {
        missingForeignKeys.push({
          table: contract.table, constraint: label,
          expected: foreignKeySummary(expectedForeignKey), sources: sourcesArray(expectedForeignKey),
        })
      } else if (!sameForeignKey(expectedForeignKey, actualForeignKey)) {
        foreignKeyMismatches.push({
          table: contract.table, constraint: label,
          expected: foreignKeySummary(expectedForeignKey), actual: foreignKeySummary(actualForeignKey), sources: sourcesArray(expectedForeignKey),
        })
      }
    }
  }
  const sortByIdentity = (left, right) => `${left.table}:${left.column || left.index || left.constraint || ""}`.localeCompare(`${right.table}:${right.column || right.index || right.constraint || ""}`)
  for (const values of [missingTables, missingColumns, columnMismatches, missingIndexes, indexMismatches, missingForeignKeys, foreignKeyMismatches]) values.sort(sortByIdentity)
  const mismatchCount = missingTables.length + missingColumns.length + columnMismatches.length
    + missingIndexes.length + indexMismatches.length + missingForeignKeys.length + foreignKeyMismatches.length
  return {
    status: mismatchCount ? "drift_detected" : "in_sync",
    mismatchCount,
    actualTableCount: actualTables.size,
    missingTables,
    missingColumns,
    columnMismatches,
    missingIndexes,
    indexMismatches,
    missingForeignKeys,
    foreignKeyMismatches,
  }
}

export function serializeExpectedCounts(expected) {
  let columns = 0
  let indexes = 0
  let foreignKeys = 0
  for (const contract of expected.values()) {
    columns += contract.columns.size
    indexes += contract.indexes.size
    foreignKeys += contract.foreignKeys.size
  }
  return { tables: expected.size, columns, indexes, foreign_keys: foreignKeys }
}
