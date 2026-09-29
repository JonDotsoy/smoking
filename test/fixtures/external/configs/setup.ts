import { writeFileSync } from "node:fs"
import { greeting } from "./helper.ts"

writeFileSync("./from-setup.txt", greeting())
console.log("setup.ts ran")
