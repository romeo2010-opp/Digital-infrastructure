const qrMatrix = [
  "111111100010101111111",
  "100000101001001000001",
  "101110101111101011101",
  "101110101000101011101",
  "101110100111101011101",
  "100000101010101000001",
  "111111101010101111111",
  "000000000111100000000",
  "110011101001001110110",
  "001100010101100010001",
  "111011111000111101011",
  "010001001111001001000",
  "111110101010101101111",
  "000000001001100101000",
  "111111100110111100101",
  "100000101001001011111",
  "101110101111100100010",
  "101110100010111001001",
  "101110101100010100111",
  "100000100011001001001",
  "111111101101111100111",
]

export function QrMatrix() {
  return (
    <div className="rounded-[28px] border border-[#d7d7d7] bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
      <div
        className="grid aspect-square w-full max-w-[210px] grid-cols-[repeat(21,minmax(0,1fr))] gap-[2px] rounded-[18px] bg-white p-2"
        aria-hidden="true"
      >
        {qrMatrix.flatMap((row, rowIndex) =>
          row.split("").map((cell, columnIndex) => (
            <span
              key={`${rowIndex}-${columnIndex}`}
              className={cell === "1" ? "rounded-[2px] bg-black" : "rounded-[2px] bg-white"}
            />
          ))
        )}
      </div>
    </div>
  )
}
