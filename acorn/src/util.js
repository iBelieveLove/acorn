const {hasOwnProperty, toString} = Object.prototype

export const hasOwn = Object.hasOwn || ((obj, propName) => (
  hasOwnProperty.call(obj, propName)
))

export const isArray = Array.isArray || ((obj) => (
  toString.call(obj) === "[object Array]"
))

/** 根据字符串生成一个正则表达式
 * @param {string} words
 * @returns {RegExp}
 */
export function wordsRegexp(words) {
  return new RegExp("^(?:" + words.replace(/ /g, "|") + ")$")
}

/**
 * 将unicode表示的字符串转成字符串
 * @param {number} code
 * @returns {string}
 * */
export function codePointToString(code) {
  // UTF-16 Decoding
  if (code <= 0xFFFF) return String.fromCharCode(code)
  code -= 0x10000
  return String.fromCharCode((code >> 10) + 0xD800, (code & 1023) + 0xDC00)
}

/** 暂不明白 */
export const loneSurrogate = /[\uD800-\uDFFF]/u
