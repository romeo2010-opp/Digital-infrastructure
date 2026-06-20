import app from "./app.js"

const port = Number(process.env.PORT || 4307)

app.listen(port, () => {
  console.log(`SmartLink Schools API listening on http://localhost:${port}`)
})
