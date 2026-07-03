export function studentCodeSortSql(alias = "s") {
  const code = `COALESCE(NULLIF(${alias}.student_id, ''), NULLIF(${alias}.admission_no, ''), '')`
  return `CASE WHEN RIGHT(${code}, 3) REGEXP '^[0-9]{3}$' THEN CAST(RIGHT(${code}, 3) AS UNSIGNED) ELSE 999999 END, ${code}`
}
