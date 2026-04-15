function escapeCsvCell(value) {
  if (value === null || value === undefined) return ""
  const text = String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`
  }
  return text
}

export function writeCsvResponse({ res, columns, rows }) {
  res.write(`${columns.map((c) => escapeCsvCell(c.header)).join(",")}\n`)
  for (const row of rows) {
    const line = columns.map((c) => escapeCsvCell(row[c.key])).join(",")
    res.write(`${line}\n`)
  }
}

