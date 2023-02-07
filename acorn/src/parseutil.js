import {TokenType, types as tt} from "./tokentype.js"
import {Parser} from "./state.js"
import {lineBreak, skipWhiteSpace} from "./whitespace.js"

const pp = Parser.prototype

// ## Parser utilities

const literal = /^(?:'((?:\\.|[^'\\])*?)'|"((?:\\.|[^"\\])*?)")/
pp.strictDirective = function(start) {
  if (this.options.ecmaVersion < 5) return false
  for (;;) {
    // Try to find string literal.
    skipWhiteSpace.lastIndex = start
    start += skipWhiteSpace.exec(this.input)[0].length
    let match = literal.exec(this.input.slice(start))
    if (!match) return false
    if ((match[1] || match[2]) === "use strict") {
      skipWhiteSpace.lastIndex = start + match[0].length
      let spaceAfter = skipWhiteSpace.exec(this.input), end = spaceAfter.index + spaceAfter[0].length
      let next = this.input.charAt(end)
      return next === ";" || next === "}" ||
        (lineBreak.test(spaceAfter[0]) &&
         !(/[(`.[+\-/*%<>=,?^&]/.test(next) || next === "!" && this.input.charAt(end + 1) === "="))
    }
    start += match[0].length

    // Skip semicolon, if any.
    skipWhiteSpace.lastIndex = start
    start += skipWhiteSpace.exec(this.input)[0].length
    if (this.input[start] === ";")
      start++
  }
}

// Predicate that tests whether the next token is of the given
// type, and if yes, consumes it as a side effect.

pp.eat = function(type) {
  if (this.type === type) {
    this.next()
    return true
  } else {
    return false
  }
}

// Tests whether parsed token is a contextual keyword.
/** 判断是否是对应的一个值 @type {string} name */
pp.isContextual = function (name) {
  return this.type === tt.name && this.value === name && !this.containsEsc
}

// Consumes contextual keyword if possible.
/** 判断当前token是否对应的name @type {string} name */
pp.eatContextual = function(name) {
  if (!this.isContextual(name)) return false
  this.next()
  return true
}

// Asserts that following token is given contextual keyword.

pp.expectContextual = function(name) {
  if (!this.eatContextual(name)) this.unexpected()
}

// Test whether a semicolon can be inserted at the current position.
/** 判断当前是不是可以插入分号的位置 */
pp.canInsertSemicolon = function() {
  return this.type === tt.eof ||
    this.type === tt.braceR ||
    lineBreak.test(this.input.slice(this.lastTokEnd, this.start))
}

/**
 * 尝试调用onInsertedSemicolon 插入分号
 * @returns {boolean}
 */
pp.insertSemicolon = function() {
  if (this.canInsertSemicolon()) {
    if (this.options.onInsertedSemicolon)
      this.options.onInsertedSemicolon(this.lastTokEnd, this.lastTokEndLoc)
    return true
  }
}

// Consume a semicolon, or, failing that, see if we are allowed to
// pretend that there is a semicolon at this position.

/**
 * 尝试消费一个分号, 如果没有, 则尝试插入一个分号
 * @throws unexpected error
 */
pp.semicolon = function() {
  if (!this.eat(tt.semi) && !this.insertSemicolon()) this.unexpected()
}

/**
 * 预期遇到对应的TokenType时返回true
 * @param {TokenType} tokType 
 * @param {boolean} notNext 
 * @returns {boolean}
 */
pp.afterTrailingComma = function(tokType, notNext) {
  if (this.type === tokType) {
    if (this.options.onTrailingComma)
      this.options.onTrailingComma(this.lastTokStart, this.lastTokStartLoc)
    if (!notNext)
      this.next()
    return true
  }
}

// Expect a token of a given type. If found, consume it, otherwise,
// raise an unexpected token error.

pp.expect = function(type) {
  this.eat(type) || this.unexpected()
}

// Raise an unexpected token error.

pp.unexpected = function(pos) {
  this.raise(pos != null ? pos : this.start, "Unexpected token")
}

export class DestructuringErrors {
  constructor() {
    this.shorthandAssign =
    this.trailingComma =
    this.parenthesizedAssign =
    this.parenthesizedBind =
    this.doubleProto =
      -1
  }
}

pp.checkPatternErrors = function(refDestructuringErrors, isAssign) {
  if (!refDestructuringErrors) return
  if (refDestructuringErrors.trailingComma > -1)
    this.raiseRecoverable(refDestructuringErrors.trailingComma, "Comma is not permitted after the rest element")
  let parens = isAssign ? refDestructuringErrors.parenthesizedAssign : refDestructuringErrors.parenthesizedBind
  if (parens > -1) this.raiseRecoverable(parens, isAssign ? "Assigning to rvalue" : "Parenthesized pattern")
}

/** 解析表达式合法性 */
pp.checkExpressionErrors = function(refDestructuringErrors, andThrow) {
  if (!refDestructuringErrors) return false
  let {shorthandAssign, doubleProto} = refDestructuringErrors
  if (!andThrow) return shorthandAssign >= 0 || doubleProto >= 0
  if (shorthandAssign >= 0)
    this.raise(shorthandAssign, "Shorthand property assignments are valid only in destructuring patterns")
  if (doubleProto >= 0)
    this.raiseRecoverable(doubleProto, "Redefinition of __proto__ property")
}

/** 检查yield和await存在的合法性 */
pp.checkYieldAwaitInDefaultParams = function() {
  if (this.yieldPos && (!this.awaitPos || this.yieldPos < this.awaitPos))
    this.raise(this.yieldPos, "Yield expression cannot be a default value")
  if (this.awaitPos)
    this.raise(this.awaitPos, "Await expression cannot be a default value")
}

pp.isSimpleAssignTarget = function(expr) {
  if (expr.type === "ParenthesizedExpression")
    return this.isSimpleAssignTarget(expr.expression)
  return expr.type === "Identifier" || expr.type === "MemberExpression"
}
