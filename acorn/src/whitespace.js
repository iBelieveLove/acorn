// Matches a whole line break (where CRLF is considered a single
// line break). Used to count lines.
/** 换行符判断 */
export const lineBreak = /\r\n?|\n|\u2028|\u2029/
export const lineBreakG = new RegExp(lineBreak.source, "g")

export function isNewLine(code) {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029
}

export function nextLineBreak(code, from, end = code.length) {
  for (let i = from; i < end; i++) {
    let next = code.charCodeAt(i)
    if (isNewLine(next))
      return i < end - 1 && next === 13 && code.charCodeAt(i + 1) === 10 ? i + 2 : i + 1
  }
  return -1
}

/** 判断是否空格的正则表达式 */
export const nonASCIIwhitespace = /[\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/

/** 用于跳过空格, 方式为设置lastIndex后, exec(xxx)[0].length, 可以得到当前位置的空格的长度 */
export const skipWhiteSpace = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g
