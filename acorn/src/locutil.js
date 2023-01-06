import {nextLineBreak} from "./whitespace.js"

// These are used when `options.locations` is on, for the
// `startLoc` and `endLoc` properties.

/** 标识第几行第几列 */
export class Position {
  /**
   * @param {number} line 
   * @param {number} col 
   */
  constructor(line, col) {
    this.line = line
    this.column = col
  }

  offset(n) {
    return new Position(this.line, this.column + n)
  }
}


export class SourceLocation {
  /**
   * @param {Parser} p 
   * @param {Position} start 
   * @param {Position} end 
   */
  constructor(p, start, end) {
    this.start = start
    this.end = end
    if (p.sourceFile !== null) this.source = p.sourceFile
  }
}

// The `getLineInfo` function is mostly useful when the
// `locations` option is off (for performance reasons) and you
// want to find the line/column position for a given character
// offset. `input` should be the code string that the offset refers
// into.

export function getLineInfo(input, offset) {
  for (let line = 1, cur = 0;;) {
    let nextBreak = nextLineBreak(input, cur, offset)
    if (nextBreak < 0) return new Position(line, offset - cur)
    ++line
    cur = nextBreak
  }
}
