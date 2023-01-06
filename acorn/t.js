const {Parser, tokTypes} = require("./dist/acorn")

const options = {
  ecmaVersion: "latest",
  sourceType: "module",
  locations: true,
  sourceFile: "./test.js"
}

// const p = new Parser()
const r = Parser.parse(`
  export class Node {
    constructor(parser, pos, loc) {
      this.type = ""
      this.start = pos
      this.end = 0
      if (parser.options.locations)
        this.loc = new SourceLocation(parser, loc)
      if (parser.options.directSourceFile)
        this.sourceFile = parser.options.directSourceFile
      if (parser.options.ranges)
        this.range = [pos, 0]
    }
  }
  const node = new Node();
  const test = 1;
  if (test === 1) console.log(node)`, options)

// let token;
// while ((token = r.getToken())) {
//   console.log(token)
//   if (token.type === tokTypes.eof) {
//     break;
//   }
// }
console.log(r)