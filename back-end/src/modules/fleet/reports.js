export function toFleetCsv(rows = []) {
  const headers = [
    "Date/time",
    "Driver",
    "Vehicle",
    "Station",
    "Fuel type",
    "Litres",
    "Amount",
    "Price/litre",
    "Status",
    "Risk",
  ]
  const escape = (value) => {
    const text = String(value ?? "")
    if (!/[",\n]/.test(text)) return text
    return `"${text.replace(/"/g, '""')}"`
  }
  const lines = [
    headers.join(","),
    ...rows.map((row) => [
      row.createdAt,
      row.driver?.fullName || row.driver?.publicId || "",
      row.vehicle?.plateNumber || "",
      row.station?.name || "",
      row.fuelType,
      row.litres,
      row.amount,
      row.pricePerLitre,
      row.status,
      row.riskStatus,
    ].map(escape).join(",")),
  ]
  return `${lines.join("\n")}\n`
}
