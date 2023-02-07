// A recursive descent parser operates by defining functions for all
// syntactic elements, and recursively calling those, each function
// advancing the input stream and returning an AST node. Precedence
// of constructs (for example, the fact that `!x[1]` means `!(x[1])`
// instead of `(!x)[1]` is handled by the fact that the parser
// function that parses unary prefix operators is called first, and
// in turn calls the function that parses `[]` subscripts — that
// way, it'll receive the node for `x[1]` already parsed, and wraps
// *that* in the unary operator node.
//
// Acorn uses an [operator precedence parser][opp] to handle binary
// operator precedence, because it is much more compact than using
// the technique outlined above, which uses different, nesting
// functions to specify precedence, for all of the ten binary
// precedence levels that JavaScript defines.
//
// [opp]: http://en.wikipedia.org/wiki/Operator-precedence_parser

import {NodeTypes, NodeTypes as nt, TokenType, types as tt} from "./tokentype.js"
import {types as tokenCtxTypes} from "./tokencontext.js"
import {Parser} from "./state.js"
import {DestructuringErrors} from "./parseutil.js"
import {lineBreak} from "./whitespace.js"
import {functionFlags, SCOPE_ARROW, SCOPE_SUPER, SCOPE_DIRECT_SUPER, BIND_OUTSIDE, BIND_VAR} from "./scopeflags.js"
import { SourceLocation } from "./locutil.js"

const pp = Parser.prototype

// Check if property name clashes with already added.
// Object/class getters and setters are not allowed to clash —
// either with each other or with an init property — and in
// strict mode, init properties are also not allowed to be repeated.
/**
 * 只有parseObj中调用, 检查prop在propHash中是否已存在, 就是检查obj中不能有重复定义.
 * @param {Node} prop 
 * @param {Record<string, any>} propHash 
 * @param {*} refDestructuringErrors 
 * @returns 
 */
pp.checkPropClash = function(prop, propHash, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 9 && prop.type === "SpreadElement")
    return
  if (this.options.ecmaVersion >= 6 && (prop.computed || prop.method || prop.shorthand))
    return
  let {key} = prop, name
  switch (key.type) {
  case "Identifier": name = key.name; break
  case "Literal": name = String(key.value); break
  default: return
  }
  let {kind} = prop
  if (this.options.ecmaVersion >= 6) {
    if (name === "__proto__" && kind === "init") {
      if (propHash.proto) {
        if (refDestructuringErrors) {
          if (refDestructuringErrors.doubleProto < 0) {
            refDestructuringErrors.doubleProto = key.start
          }
        } else {
          this.raiseRecoverable(key.start, "Redefinition of __proto__ property")
        }
      }
      propHash.proto = true
    }
    return
  }
  name = "$" + name
  let other = propHash[name]
  if (other) {
    let redefinition
    if (kind === "init") {
      redefinition = this.strict && other.init || other.get || other.set
    } else {
      redefinition = other.init || other[kind]
    }
    if (redefinition)
      this.raiseRecoverable(key.start, "Redefinition of property")
  } else {
    other = propHash[name] = {
      init: false,
      get: false,
      set: false
    }
  }
  other[kind] = true
}

// ### Expression parsing

// These nest, from the most general expression type at the top to
// 'atomic', nondivisible expression types at the bottom. Most of
// the functions will simply let the function(s) below them parse,
// and, *if* the syntactic construct they handle is present, wrap
// the AST node that the inner parser gave them in another node.

// Parse a full expression. The optional arguments are used to
// forbid the `in` operator (in for loops initalization expressions)
// and provide reference for storing '=' operator inside shorthand
// property assignment in contexts where both object expression
// and object pattern might appear (so it's possible to raise
// delayed syntax error at correct position).
/**
 * 解析单条表达式, 主要是赋值表达式.
 * @param {string | boolean} forInit let/const/var
 * @param {*} refDestructuringErrors 
 * @returns 
 */
pp.parseExpression = function(forInit, refDestructuringErrors) {
  let startPos = this.start, startLoc = this.startLoc
  // let a = b;
  let expr = this.parseMaybeAssign(forInit, refDestructuringErrors)
  if (this.type === tt.comma) {
    // let a,b,c = xxx;
    let node = this.startNodeAt(startPos, startLoc)
    node.expressions = [expr]
    while (this.eat(tt.comma)) node.expressions.push(this.parseMaybeAssign(forInit, refDestructuringErrors))
    return this.finishNode(node, "SequenceExpression")
  }
  return expr
}

// Parse an assignment expression. This includes applications of
// operators like `+=`.
/**
 * 解析 a = b; a += b; xxx -= xxxx;
 * 同时兼容三元表达式a?b:c
 * 解析时, 表达式支持逻辑运算符等
 * @param {string | boolean} forInit 
 * @param {*} refDestructuringErrors 
 * @param {Function} afterLeftParse 
 * @returns 
 */
pp.parseMaybeAssign = function(forInit, refDestructuringErrors, afterLeftParse) {
  if (this.isContextual("yield")) {
    if (this.inGenerator) return this.parseYield(forInit)
    // The tokenizer will assume an expression is allowed after
    // `yield`, but this isn't that kind of yield
    else this.exprAllowed = false
  }

  let ownDestructuringErrors = false, oldParenAssign = -1, oldTrailingComma = -1, oldDoubleProto = -1
  if (refDestructuringErrors) {
    oldParenAssign = refDestructuringErrors.parenthesizedAssign
    oldTrailingComma = refDestructuringErrors.trailingComma
    oldDoubleProto = refDestructuringErrors.doubleProto
    refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = -1
  } else {
    refDestructuringErrors = new DestructuringErrors
    ownDestructuringErrors = true
  }

  let startPos = this.start, startLoc = this.startLoc
  if (this.type === tt.parenL || this.type === tt.name) {
    this.potentialArrowAt = this.start
    this.potentialArrowInForAwait = forInit === "await"
  }
  let left = this.parseMaybeConditional(forInit, refDestructuringErrors)
  if (afterLeftParse) left = afterLeftParse.call(this, left, startPos, startLoc)
  if (this.type.isAssign) {
    let node = this.startNodeAt(startPos, startLoc)
    node.operator = this.value
    if (this.type === tt.eq)
      left = this.toAssignable(left, false, refDestructuringErrors)
    if (!ownDestructuringErrors) {
      refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = refDestructuringErrors.doubleProto = -1
    }
    if (refDestructuringErrors.shorthandAssign >= left.start)
      refDestructuringErrors.shorthandAssign = -1 // reset because shorthand default was used correctly
    if (this.type === tt.eq)
      this.checkLValPattern(left)
    else
      this.checkLValSimple(left)
    node.left = left
    this.next()
    node.right = this.parseMaybeAssign(forInit)
    if (oldDoubleProto > -1) refDestructuringErrors.doubleProto = oldDoubleProto
    return this.finishNode(node, NodeTypes.AssignmentExpression)
  } else {
    if (ownDestructuringErrors) this.checkExpressionErrors(refDestructuringErrors, true)
  }
  if (oldParenAssign > -1) refDestructuringErrors.parenthesizedAssign = oldParenAssign
  if (oldTrailingComma > -1) refDestructuringErrors.trailingComma = oldTrailingComma
  return left
}

// Parse a ternary conditional (`?:`) operator.
/**
 * 只有在parseMaybeAssign中调用
 * 解析 ? : 三元表达式
 * @param {string} forInit 
 * @param {*} refDestructuringErrors 
 * @returns 
 */
pp.parseMaybeConditional = function(forInit, refDestructuringErrors) {
  let startPos = this.start, startLoc = this.startLoc
  let expr = this.parseExprOps(forInit, refDestructuringErrors)
  if (this.checkExpressionErrors(refDestructuringErrors)) return expr
  if (this.eat(tt.question)) {
    let node = this.startNodeAt(startPos, startLoc)
    node.test = expr // ? 前面的内容
    node.consequent = this.parseMaybeAssign() // 第一个表达式
    this.expect(tt.colon) // :
    node.alternate = this.parseMaybeAssign(forInit) // 第二个表达式
    return this.finishNode(node, NodeTypes.ConditionalExpression)
  }
  return expr
}

// Start the precedence parser.
/**
 * 只有parseMaybeConditional调用, 解析表达式
 * @param {string} forInit
 */
pp.parseExprOps = function(forInit, refDestructuringErrors) {
  let startPos = this.start, startLoc = this.startLoc
  let expr = this.parseMaybeUnary(refDestructuringErrors, false, false, forInit)
  if (this.checkExpressionErrors(refDestructuringErrors)) return expr
  return expr.start === startPos && expr.type === "ArrowFunctionExpression" ? expr : this.parseExprOp(expr, startPos, startLoc, -1, forInit)
}

// Parse binary operators with the operator precedence parsing
// algorithm. `left` is the left-hand side of the operator.
// `minPrec` provides context that allows the function to stop and
// defer further parser to one of its callers when it encounters an
// operator that has a lower precedence than the set it is parsing.

/**
 * 解析计算表达式, 解析类似 a || b, a >> b, c * d 这样的表达式
 * @param {Node} left 
 * @param {Position} leftStartPos 
 * @param {SourceLocation} leftStartLoc 
 * @param {number} minPrec 
 * @param {string} forInit 
 * @returns 
 */
pp.parseExprOp = function (left, leftStartPos, leftStartLoc, minPrec, forInit) {
  // binop 在进行位运算, 逻辑运算等计算时存在
  let prec = this.type.binop
  if (prec != null && (!forInit || this.type !== tt._in)) {
    if (prec > minPrec) {
      let logical = this.type === tt.logicalOR || this.type === tt.logicalAND
      let coalesce = this.type === tt.coalesce
      if (coalesce) {
        // Handle the precedence of `tt.coalesce` as equal to the range of logical expressions.
        // In other words, `node.right` shouldn't contain logical expressions in order to check the mixed error.
        prec = tt.logicalAND.binop
      }
      let op = this.value
      this.next()
      let startPos = this.start, startLoc = this.startLoc
      let right = this.parseExprOp(this.parseMaybeUnary(null, false, false, forInit), startPos, startLoc, prec, forInit)
      let node = this.buildBinary(leftStartPos, leftStartLoc, left, right, op, logical || coalesce)
      if ((logical && this.type === tt.coalesce) || (coalesce && (this.type === tt.logicalOR || this.type === tt.logicalAND))) {
        this.raiseRecoverable(this.start, "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses")
      }
      return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, forInit)
    }
  }
  return left
}

/**
 * 根据左右node的类型构建node
 * @param {*} startPos 
 * @param {*} startLoc 
 * @param {Node} left 
 * @param {Node} right 
 * @param {string} op 
 * @param {boolean} logical 标识是否逻辑运算符&& 或者||或者??
 * @returns 
 */
pp.buildBinary = function(startPos, startLoc, left, right, op, logical) {
  if (right.type === "PrivateIdentifier") this.raise(right.start, "Private identifier can only be left side of binary expression")
  let node = this.startNodeAt(startPos, startLoc)
  node.left = left
  node.operator = op
  node.right = right
  return this.finishNode(node, logical ? "LogicalExpression" : "BinaryExpression")
}

// Parse unary operators, both prefix and postfix.
/**
 * 读出单个变量或者表达式, 如a, b.c, ccc[0], ddd(), ++a, a++, delete a[1], typeof a
 * @param {*} refDestructuringErrors 
 * @param {boolean} sawUnary 
 * @param {boolean} incDec 
 * @param {*} forInit 
 * @returns 
 */
pp.parseMaybeUnary = function(refDestructuringErrors, sawUnary, incDec, forInit) {
  let startPos = this.start, startLoc = this.startLoc, expr
  if (this.isContextual("await") && this.canAwait) {
    // 如果允许await 则调用parseAwait
    expr = this.parseAwait(forInit)
    sawUnary = true
  } else if (this.type.prefix) {
    // 如果是++/--或者typeof, delete等
    let node = this.startNode(), update = this.type === tt.incDec
    node.operator = this.value
    node.prefix = true
    this.next()
    // 读出需要操作的变量
    node.argument = this.parseMaybeUnary(null, true, update, forInit)
    this.checkExpressionErrors(refDestructuringErrors, true)
    // 如果是++/--, 检查合法性
    if (update) this.checkLValSimple(node.argument)
    else if (this.strict && node.operator === "delete" &&
             node.argument.type === "Identifier")
      // 如果是delete aaa这种类型, 报错       
      this.raiseRecoverable(node.start, "Deleting local variable in strict mode")
    else if (node.operator === "delete" && isPrivateFieldAccess(node.argument))
      // 如果是私有变量, 则报错
      this.raiseRecoverable(node.start, "Private fields can not be deleted")
    else sawUnary = true
    expr = this.finishNode(node, update ? nt.UpdateExpression : nt.UnaryExpression)
  } else if (!sawUnary && this.type === tt.privateId) {
    if (forInit || this.privateNameStack.length === 0) this.unexpected()
    // 解析私有变量
    expr = this.parsePrivateIdent()
    // only could be private fields in 'in', such as #x in obj
    // 在这里私有变量下一个词必须接in, 否则错误
    if (this.type !== tt._in) this.unexpected()
  } else {
    expr = this.parseExprSubscripts(refDestructuringErrors, forInit)
    // 这一段检查没懂
    if (this.checkExpressionErrors(refDestructuringErrors)) return expr
    while (this.type.postfix && !this.canInsertSemicolon()) {
      // ++/--
      let node = this.startNodeAt(startPos, startLoc)
      node.operator = this.value
      node.prefix = false
      node.argument = expr
      this.checkLValSimple(expr)
      this.next()
      expr = this.finishNode(node, nt.UnaryExpression)
    }
  }

  if (!incDec && this.eat(tt.starstar)) {
    if (sawUnary)
      this.unexpected(this.lastTokStart)
    else
      return this.buildBinary(startPos, startLoc, expr, this.parseMaybeUnary(null, false, false, forInit), "**", false)
  } else {
    return expr
  }
}

// 是否私有变量
function isPrivateFieldAccess(node) {
  return (
    node.type === "MemberExpression" && node.property.type === "PrivateIdentifier" ||
    node.type === "ChainExpression" && isPrivateFieldAccess(node.expression)
  )
}

// Parse call, dot, and `[]`-subscript expressions.
/**
 * 解析调用链或者箭头函数, 主要在parseMaybeUnary中调用.
 * 正常情况下, 默认会进入这里解析.
 * @param {*} refDestructuringErrors 
 * @param {*} forInit 
 * @returns 
 */
pp.parseExprSubscripts = function (refDestructuringErrors, forInit) {
  let startPos = this.start, startLoc = this.startLoc
  let expr = this.parseExprAtom(refDestructuringErrors, forInit)
  // 箭头函数
  if (expr.type === NodeTypes.ArrowFunctionExpression && this.input.slice(this.lastTokStart, this.lastTokEnd) !== ")")
    return expr
  let result = this.parseSubscripts(expr, startPos, startLoc, false, forInit)
  if (refDestructuringErrors && result.type === NodeTypes.MemberExpression) {
    if (refDestructuringErrors.parenthesizedAssign >= result.start) refDestructuringErrors.parenthesizedAssign = -1
    if (refDestructuringErrors.parenthesizedBind >= result.start) refDestructuringErrors.parenthesizedBind = -1
    if (refDestructuringErrors.trailingComma >= result.start) refDestructuringErrors.trailingComma = -1
  }
  return result
}

/**
 * 解析整条调用链, 最后返回的结果是以最后的node开头, 如a.b.c, 返回时返回的是c的node
 * 这里是读到了字母开头的token进入
 * @param {Node} base 
 * @param {number} startPos 
 * @param {Position} startLoc 
 * @param {boolean} noCalls 
 * @param {string} forInit 
 * @returns 
 */
pp.parseSubscripts = function (base, startPos, startLoc, noCalls, forInit) {
  // async () => {}
  let maybeAsyncArrow = this.options.ecmaVersion >= 8 && base.type === "Identifier" && base.name === "async" &&
      this.lastTokEnd === base.end && !this.canInsertSemicolon() && base.end - base.start === 5 &&
      this.potentialArrowAt === base.start
  let optionalChained = false

  while (true) {
    let element = this.parseSubscript(base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained, forInit)

    if (element.optional) optionalChained = true // 可选链
    if (element === base || element.type === NodeTypes.ArrowFunctionExpression) {
      if (optionalChained) {
        const chainNode = this.startNodeAt(startPos, startLoc)
        chainNode.expression = element
        element = this.finishNode(chainNode, NodeTypes.ChainExpression)
      }
      return element
    }

    base = element
  }
}

/**
 * 解析调用链, 如果有解析到新内容, 则返回新node, 否则返回原有base.
 * 如果解析到点号, 或者[, 则往下解析新内容, 否则返回base
 * @param {Node} base 
 * @param {*} startPos 
 * @param {*} startLoc 
 * @param {boolean} noCalls 
 * @param {boolean} maybeAsyncArrow 可能是async () => {}
 * @param {*} optionalChained 
 * @param {*} forInit 
 * @returns 
 */
pp.parseSubscript = function(base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained, forInit) {
  let optionalSupported = this.options.ecmaVersion >= 11
  // ?. 合法调用: obj.val?.prop  obj.val?.[expr] obj.func?.(args)
  let optional = optionalSupported && this.eat(tt.questionDot)
  if (noCalls && optional) this.raise(this.lastTokStart, "Optional chaining cannot appear in the callee of new expressions")
  // []这种情况, 适用于对象和列表类型变量
  let computed = this.eat(tt.bracketL)
  // []或.或 非?.( 非?.`(但可选链应该不允许后接模版), 解析成员表达式
  if (computed || (optional && this.type !== tt.parenL && this.type !== tt.backQuote) || this.eat(tt.dot)) {
    let node = this.startNodeAt(startPos, startLoc)
    // 设置父对象
    node.object = base
    // 解析成员表达式
    if (computed) {
      node.property = this.parseExpression()
      this.expect(tt.bracketR)
    } else if (this.type === tt.privateId && base.type !== "Super") {
      node.property = this.parsePrivateIdent()
    } else {
      node.property = this.parseIdent(this.options.allowReserved !== "never")
    }
    // 是否动态获取
    node.computed = !!computed
    if (optionalSupported) {
      // 是否可选链
      node.optional = optional
    }
    base = this.finishNode(node, NodeTypes.MemberExpression)
  } else if (!noCalls && this.eat(tt.parenL)) {
    // 读到左括号
    let refDestructuringErrors = new DestructuringErrors, oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos
    this.yieldPos = 0
    this.awaitPos = 0
    this.awaitIdentPos = 0
    // 解析出一组表达式, 
    let exprList = this.parseExprList(tt.parenR, this.options.ecmaVersion >= 8, false, refDestructuringErrors)
    // 进入这里肯定不会是左括号开头, 所以这里如果是箭头函数, 一定是async
    if (maybeAsyncArrow && !optional && !this.canInsertSemicolon() && this.eat(tt.arrow)) {
      this.checkPatternErrors(refDestructuringErrors, false)
      this.checkYieldAwaitInDefaultParams()
      if (this.awaitIdentPos > 0)
        this.raise(this.awaitIdentPos, "Cannot use 'await' as identifier inside an async function")
      this.yieldPos = oldYieldPos
      this.awaitPos = oldAwaitPos
      this.awaitIdentPos = oldAwaitIdentPos
      return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, true, forInit)
    }
    this.checkExpressionErrors(refDestructuringErrors, true)
    this.yieldPos = oldYieldPos || this.yieldPos
    this.awaitPos = oldAwaitPos || this.awaitPos
    this.awaitIdentPos = oldAwaitIdentPos || this.awaitIdentPos
    let node = this.startNodeAt(startPos, startLoc)
    node.callee = base
    node.arguments = exprList
    if (optionalSupported) {
      node.optional = optional
    }
    base = this.finishNode(node, NodeTypes.CallExpression)
  } else if (this.type === tt.backQuote) {
    // https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Template_literals
    // tag`test ${ddd} zzz` 这种类型
    if (optional || optionalChained) {
      this.raise(this.start, "Optional chaining cannot appear in the tag of tagged template expressions")
    }
    let node = this.startNodeAt(startPos, startLoc)
    node.tag = base
    node.quasi = this.parseTemplate({isTagged: true})
    base = this.finishNode(node, NodeTypes.TaggedTemplateExpression)
  }
  return base
}

// Parse an atomic expression — either a single token that is an
// expression, an expression started by a keyword like `function` or
// `new`, or an expression wrapped in punctuation like `()`, `[]`,
// or `{}`.
/**
 * 解析单个表达式, 可能是function, 或者new 开头, 或者是被括号包起来的内容.
 * 
 */
pp.parseExprAtom = function(refDestructuringErrors, forInit) {
  // If a division operator appears in an expression position, the
  // tokenizer got confused, and we force it to read a regexp instead.
  if (this.type === tt.slash) this.readRegexp()
  let node, canBeArrow = this.potentialArrowAt === this.start
  switch (this.type) {
  case tt._super:
    if (!this.allowSuper)
      this.raise(this.start, "'super' keyword outside a method")
    node = this.startNode()
    this.next()
    if (this.type === tt.parenL && !this.allowDirectSuper)
      this.raise(node.start, "super() call outside constructor of a subclass")
    // The `super` keyword can appear at below:
    // SuperProperty:
    //     super [ Expression ]
    //     super . IdentifierName
    // SuperCall:
    //     super ( Arguments )
    if (this.type !== tt.dot && this.type !== tt.bracketL && this.type !== tt.parenL)
      this.unexpected()
    return this.finishNode(node, "Super")

  case tt._this:
    node = this.startNode()
    this.next()
    return this.finishNode(node, "ThisExpression")

  case tt.name:
    let startPos = this.start, startLoc = this.startLoc, containsEsc = this.containsEsc
    let id = this.parseIdent(false)
    if (this.options.ecmaVersion >= 8 && !containsEsc && id.name === "async" && !this.canInsertSemicolon() && this.eat(tt._function)) {
      this.overrideContext(tokenCtxTypes.f_expr)
      return this.parseFunction(this.startNodeAt(startPos, startLoc), 0, false, true, forInit)
    }
    if (canBeArrow && !this.canInsertSemicolon()) {
      if (this.eat(tt.arrow))
        return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], false, forInit)
      if (this.options.ecmaVersion >= 8 && id.name === "async" && this.type === tt.name && !containsEsc &&
          (!this.potentialArrowInForAwait || this.value !== "of" || this.containsEsc)) {
        id = this.parseIdent(false)
        if (this.canInsertSemicolon() || !this.eat(tt.arrow))
          this.unexpected()
        return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], true, forInit)
      }
    }
    return id

  case tt.regexp: // 这里特指/reg/
    let value = this.value
    node = this.parseLiteral(value.value)
    node.regex = {pattern: value.pattern, flags: value.flags}
    return node

  case tt.num: case tt.string:
    return this.parseLiteral(this.value)

  case tt._null: case tt._true: case tt._false:
    node = this.startNode()
    node.value = this.type === tt._null ? null : this.type === tt._true
    node.raw = this.type.keyword
    this.next()
    return this.finishNode(node, nt.Literal)

  case tt.parenL:
    let start = this.start, expr = this.parseParenAndDistinguishExpression(canBeArrow, forInit)
    if (refDestructuringErrors) {
      if (refDestructuringErrors.parenthesizedAssign < 0 && !this.isSimpleAssignTarget(expr))
        refDestructuringErrors.parenthesizedAssign = start
      if (refDestructuringErrors.parenthesizedBind < 0)
        refDestructuringErrors.parenthesizedBind = start
    }
    return expr

  case tt.bracketL: // [
    node = this.startNode()
    this.next()
    node.elements = this.parseExprList(tt.bracketR, true, true, refDestructuringErrors)
    return this.finishNode(node, nt.ArrayExpression)

  case tt.braceL: // {
    this.overrideContext(tokenCtxTypes.b_expr)
    return this.parseObj(false, refDestructuringErrors)

  case tt._function:
    node = this.startNode()
    this.next()
    return this.parseFunction(node, 0)

  case tt._class:
    return this.parseClass(this.startNode(), false)

  case tt._new:
    return this.parseNew()

  case tt.backQuote:
    return this.parseTemplate()

  case tt._import:
    if (this.options.ecmaVersion >= 11) {
      return this.parseExprImport()
    } else {
      return this.unexpected()
    }

  default:
    this.unexpected()
  }
}

/**
 * 只在parseExprAtom调用
 * @returns 
 */
pp.parseExprImport = function() {
  const node = this.startNode()

  // Consume `import` as an identifier for `import.meta`.
  // Because `this.parseIdent(true)` doesn't check escape sequences, it needs the check of `this.containsEsc`.
  if (this.containsEsc) this.raiseRecoverable(this.start, "Escape sequence in keyword import")
  const meta = this.parseIdent(true)

  switch (this.type) {
  case tt.parenL:
    return this.parseDynamicImport(node)
  case tt.dot:
    node.meta = meta
    return this.parseImportMeta(node)
  default:
    this.unexpected()
  }
}

/**
 * 只在parseExprImport调用
 * @param {*} node 
 * @returns 
 */
pp.parseDynamicImport = function(node) {
  this.next() // skip `(`

  // Parse node.source.
  node.source = this.parseMaybeAssign()

  // Verify ending.
  if (!this.eat(tt.parenR)) {
    const errorPos = this.start
    if (this.eat(tt.comma) && this.eat(tt.parenR)) {
      this.raiseRecoverable(errorPos, "Trailing comma is not allowed in import()")
    } else {
      this.unexpected(errorPos)
    }
  }

  return this.finishNode(node, "ImportExpression")
}

/**
 * 只在parseExprImport调用
 * @param {*} node 
 * @returns 
 */
pp.parseImportMeta = function(node) {
  this.next() // skip `.`

  const containsEsc = this.containsEsc
  node.property = this.parseIdent(true)

  if (node.property.name !== "meta")
    this.raiseRecoverable(node.property.start, "The only valid meta property for import is 'import.meta'")
  if (containsEsc)
    this.raiseRecoverable(node.start, "'import.meta' must not contain escaped characters")
  if (this.options.sourceType !== "module" && !this.options.allowImportExportEverywhere)
    this.raiseRecoverable(node.start, "Cannot use 'import.meta' outside a module")

  return this.finishNode(node, "MetaProperty")
}

pp.parseLiteral = function(value) {
  let node = this.startNode()
  node.value = value
  node.raw = this.input.slice(this.start, this.end)
  if (node.raw.charCodeAt(node.raw.length - 1) === 110) node.bigint = node.raw.slice(0, -1).replace(/_/g, "")
  this.next()
  return this.finishNode(node, "Literal")
}

/**
 * 解析表达式语句, 类似while (aaa > bbb)的括号部分
 * @returns {Node}
 */
pp.parseParenExpression = function() {
  this.expect(tt.parenL)
  let val = this.parseExpression()
  this.expect(tt.parenR)
  return val
}

/**
 * 只在parseExprAtom中调用, 在遇到(时调用
 * @param {boolean} canBeArrow 
 * @param {*} forInit 
 * @returns 
 */
pp.parseParenAndDistinguishExpression = function(canBeArrow, forInit) {
  let startPos = this.start, startLoc = this.startLoc, val, allowTrailingComma = this.options.ecmaVersion >= 8
  if (this.options.ecmaVersion >= 6) {
    this.next()

    let innerStartPos = this.start, innerStartLoc = this.startLoc
    let exprList = [], first = true, lastIsComma = false
    let refDestructuringErrors = new DestructuringErrors, oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, spreadStart
    this.yieldPos = 0
    this.awaitPos = 0
    // Do not save awaitIdentPos to allow checking awaits nested in parameters
    while (this.type !== tt.parenR) {
      first ? first = false : this.expect(tt.comma)
      if (allowTrailingComma && this.afterTrailingComma(tt.parenR, true)) {
        lastIsComma = true
        break
      } else if (this.type === tt.ellipsis) {
        spreadStart = this.start
        exprList.push(this.parseParenItem(this.parseRestBinding()))
        if (this.type === tt.comma) this.raise(this.start, "Comma is not permitted after the rest element")
        break
      } else {
        exprList.push(this.parseMaybeAssign(false, refDestructuringErrors, this.parseParenItem))
      }
    }
    let innerEndPos = this.lastTokEnd, innerEndLoc = this.lastTokEndLoc
    this.expect(tt.parenR)

    if (canBeArrow && !this.canInsertSemicolon() && this.eat(tt.arrow)) {
      this.checkPatternErrors(refDestructuringErrors, false)
      this.checkYieldAwaitInDefaultParams()
      this.yieldPos = oldYieldPos
      this.awaitPos = oldAwaitPos
      return this.parseParenArrowList(startPos, startLoc, exprList, forInit)
    }

    if (!exprList.length || lastIsComma) this.unexpected(this.lastTokStart)
    if (spreadStart) this.unexpected(spreadStart)
    this.checkExpressionErrors(refDestructuringErrors, true)
    this.yieldPos = oldYieldPos || this.yieldPos
    this.awaitPos = oldAwaitPos || this.awaitPos

    if (exprList.length > 1) {
      val = this.startNodeAt(innerStartPos, innerStartLoc)
      val.expressions = exprList
      // 只有这里会设置为Sequence Expression
      this.finishNodeAt(val, nt.SequenceExpression, innerEndPos, innerEndLoc)
    } else {
      val = exprList[0]
    }
  } else {
    val = this.parseParenExpression()
  }

  if (this.options.preserveParens) {
    let par = this.startNodeAt(startPos, startLoc)
    par.expression = val
    return this.finishNode(par, "ParenthesizedExpression")
  } else {
    return val
  }
}

/** 无作用 */
pp.parseParenItem = function(item) {
  return item
}

/** 只在parseExprAtom中调用 */
pp.parseParenArrowList = function(startPos, startLoc, exprList, forInit) {
  return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, false, forInit)
}

// New's precedence is slightly tricky. It must allow its argument to
// be a `[]` or dot subscript expression, but not a call — at least,
// not without wrapping it in parentheses. Thus, it uses the noCalls
// argument to parseSubscripts to prevent it from consuming the
// argument list.

const empty = []

/**
 * 只在parseExprAtom中调用, 解析new.target, new func, new func(xxx)
 * @returns 
 */
pp.parseNew = function() {
  if (this.containsEsc) this.raiseRecoverable(this.start, "Escape sequence in keyword new")
  let node = this.startNode()
  let meta = this.parseIdent(true)
  if (this.options.ecmaVersion >= 6 && this.eat(tt.dot)) {
    node.meta = meta
    let containsEsc = this.containsEsc
    node.property = this.parseIdent(true)
    if (node.property.name !== "target")
      this.raiseRecoverable(node.property.start, "The only valid meta property for new is 'new.target'")
    if (containsEsc)
      this.raiseRecoverable(node.start, "'new.target' must not contain escaped characters")
    if (!this.allowNewDotTarget)
      this.raiseRecoverable(node.start, "'new.target' can only be used in functions and class static block")
    return this.finishNode(node, nt.MetaProperty)
  }
  let startPos = this.start, startLoc = this.startLoc, isImport = this.type === tt._import
  node.callee = this.parseSubscripts(this.parseExprAtom(), startPos, startLoc, true, false)
  if (isImport && node.callee.type === "ImportExpression") {
    this.raise(startPos, "Cannot use new with import()")
  }
  if (this.eat(tt.parenL)) node.arguments = this.parseExprList(tt.parenR, this.options.ecmaVersion >= 8, false)
  else node.arguments = empty
  return this.finishNode(node, nt.NewExpression)
}

// Parse template expression.
/**
 * 只在parseTemplate中调用
 * @param {*} param0 
 * @returns 
 */
pp.parseTemplateElement = function({isTagged}) {
  let elem = this.startNode()
  if (this.type === tt.invalidTemplate) {
    if (!isTagged) {
      this.raiseRecoverable(this.start, "Bad escape sequence in untagged template literal")
    }
    elem.value = {
      raw: this.value,
      cooked: null
    }
  } else {
    elem.value = {
      raw: this.input.slice(this.start, this.end).replace(/\r\n?/g, "\n"),
      cooked: this.value
    }
  }
  this.next()
  elem.tail = this.type === tt.backQuote
  return this.finishNode(elem, "TemplateElement")
}

/**
 * 在parseSubscript和parseExprAtom中, 读到`时调用
 * 返回的node中, 有quasis和expressions两组列表, 类似`a${b}c`这种, 解析结果为quasis=[a,c], expressions=[b]
 * @param {*} param0 
 * @returns 
 */
pp.parseTemplate = function({isTagged = false} = {}) {
  let node = this.startNode()
  this.next()
  node.expressions = []
  let curElt = this.parseTemplateElement({isTagged})
  node.quasis = [curElt]
  while (!curElt.tail) {
    if (this.type === tt.eof) this.raise(this.pos, "Unterminated template literal")
    this.expect(tt.dollarBraceL)
    node.expressions.push(this.parseExpression())
    this.expect(tt.braceR)
    node.quasis.push(curElt = this.parseTemplateElement({isTagged}))
  }
  this.next()
  return this.finishNode(node, "TemplateLiteral")
}
// 判断是否async 参数
pp.isAsyncProp = function(prop) {
  return !prop.computed && prop.key.type === "Identifier" && prop.key.name === "async" &&
    (this.type === tt.name || this.type === tt.num || this.type === tt.string || this.type === tt.bracketL || this.type.keyword || (this.options.ecmaVersion >= 9 && this.type === tt.star)) &&
    !lineBreak.test(this.input.slice(this.lastTokEnd, this.start))
}

// Parse an object literal or binding pattern.
/**
 * 解析一个object
 * 例如let a = {a: 1, b: 2}, let {a, b = 2} = aaa,  
 * @param {boolean} isPattern 表示非初始化式
 * @param {*} refDestructuringErrors 
 * @returns 
 */
pp.parseObj = function (isPattern, refDestructuringErrors) {
  let node = this.startNode(), first = true, propHash = {}
  node.properties = []
  this.next()
  // 循环读取, 直到遇到结束符}
  while (!this.eat(tt.braceR)) {
    if (!first) {
      this.expect(tt.comma)
      if (this.options.ecmaVersion >= 5 && this.afterTrailingComma(tt.braceR)) break
    } else first = false
    // 使用parseProperty解析出prop的属性, 这里有两种模式key和key: val
    const prop = this.parseProperty(isPattern, refDestructuringErrors)
    if (!isPattern) this.checkPropClash(prop, propHash, refDestructuringErrors)
    node.properties.push(prop)
  }
  return this.finishNode(node, isPattern ? NodeTypes.ObjectPattern : NodeTypes.ObjectExpression)
}

/**
 * 只有parseObj调用
 * 通常有3种形式: key, key: val, ...keys, 还有特殊形式: function定义, 如`{ fn(){}, async fn1(){}, *gen(){} }`
 * @param {boolean} isPattern 表示非初始化式
 * @param {*} refDestructuringErrors 
 * @returns 
 */
pp.parseProperty = function(isPattern, refDestructuringErrors) {
  let prop = this.startNode(), isGenerator, isAsync, startPos, startLoc
  // 如果读到...
  if (this.options.ecmaVersion >= 9 && this.eat(tt.ellipsis)) {
    if (isPattern) {
      prop.argument = this.parseIdent(false)
      if (this.type === tt.comma) {
        this.raise(this.start, "Comma is not permitted after the rest element")
      }
      return this.finishNode(prop, NodeTypes.RestElement)
    }
    // Parse argument.
    prop.argument = this.parseMaybeAssign(false, refDestructuringErrors)
    // To disallow trailing comma via `this.toAssignable()`.
    if (this.type === tt.comma && refDestructuringErrors && refDestructuringErrors.trailingComma < 0) {
      refDestructuringErrors.trailingComma = this.start
    }
    // Finish
    return this.finishNode(prop, NodeTypes.SpreadElement)
  }
  if (this.options.ecmaVersion >= 6) {
    prop.method = false
    prop.shorthand = false
    if (isPattern || refDestructuringErrors) {
      startPos = this.start
      startLoc = this.startLoc
    }
    if (!isPattern)
      isGenerator = this.eat(tt.star) // generator 判断
  }
  let containsEsc = this.containsEsc
  this.parsePropertyName(prop)
  if (!isPattern && !containsEsc && this.options.ecmaVersion >= 8 && !isGenerator && this.isAsyncProp(prop)) {
    // { async fn() { } } | { *fn() { } }
    isAsync = true
    isGenerator = this.options.ecmaVersion >= 9 && this.eat(tt.star)
    this.parsePropertyName(prop, refDestructuringErrors)
  } else {
    isAsync = false
  }
  this.parsePropertyValue(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc)
  return this.finishNode(prop, "Property")
}

/**
 * 只在parseProperty中调用
 * 解析property的值, 这里有两种形式, 冒号后赋值语句, { fn(){} }这种特殊形式下的函数定义语句.
 * @param {Node} prop 
 * @param {boolean} isPattern 表示非初始化式
 * @param {boolean} isGenerator 
 * @param {boolean} isAsync 
 * @param {*} startPos 
 * @param {*} startLoc 
 * @param {*} refDestructuringErrors 
 * @param {*} containsEsc 表示是否前面存在反斜杠
 */
pp.parsePropertyValue = function(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc) {
  if ((isGenerator || isAsync) && this.type === tt.colon) // 函数定义的时候不能接冒号
    this.unexpected()

  if (this.eat(tt.colon)) {
    // 如果读到冒号, 则此时设置kind为init, 判断是否isPattern, 是则调用`parseMaybeDefault`读出值, 否则调用`parseMaybeAssign`读出值, 设置到value中
    prop.value = isPattern ? this.parseMaybeDefault(this.start, this.startLoc) : this.parseMaybeAssign(false, refDestructuringErrors)
    prop.kind = "init"
  } else if (this.options.ecmaVersion >= 6 && this.type === tt.parenL) {
    if (isPattern) this.unexpected()
    // 判断当前是否读到`(`, 如果是, 则判断isPattern, 如果是则报错, 否则, 设置method为true, 然后调用`parseMethod`解析函数定义, 设置到init上
    // 对应的是`{ fn(){}, *genera(){}, async func(){} }`三种情况
    prop.kind = "init"
    prop.method = true
    // 解析内容
    prop.value = this.parseMethod(isGenerator, isAsync)
  } else if (!isPattern && !containsEsc &&
             this.options.ecmaVersion >= 5 && !prop.computed && prop.key.type === NodeTypes.Identifier &&
             (prop.key.name === "get" || prop.key.name === "set") &&
             (this.type !== tt.comma && this.type !== tt.braceR && this.type !== tt.eq)) {
    if (isGenerator || isAsync) this.unexpected()
    // 判断当前type为`Identifier`, 并且name为get或set的时候, 将name设置到kind中
    // 然后调用`parsePropertyName`解析出对应的变量名, 然后调用`parseMethod`解析出运算表达式, 设置到node.value中
    prop.kind = prop.key.name
    this.parsePropertyName(prop)
    prop.value = this.parseMethod(false)
    let paramCount = prop.kind === "get" ? 0 : 1
    if (prop.value.params.length !== paramCount) {
      let start = prop.value.start
      if (prop.kind === "get")
        this.raiseRecoverable(start, "getter should have no params")
      else
        this.raiseRecoverable(start, "setter should have exactly one param")
    } else {
      if (prop.kind === "set" && prop.value.params[0].type === "RestElement")
        this.raiseRecoverable(prop.value.params[0].start, "Setter cannot use rest params")
    }
  } else if (this.options.ecmaVersion >= 6 && !prop.computed && prop.key.type === "Identifier") {
    if (isGenerator || isAsync) this.unexpected()
    this.checkUnreserved(prop.key)
    // 对应{ a }, 或者let { a = 2} = xxx
    if (prop.key.name === "await" && !this.awaitIdentPos)
      this.awaitIdentPos = startPos
    prop.kind = "init"
    if (isPattern) {
      prop.value = this.parseMaybeDefault(startPos, startLoc, this.copyNode(prop.key))
    } else if (this.type === tt.eq && refDestructuringErrors) {
      if (refDestructuringErrors.shorthandAssign < 0)
        refDestructuringErrors.shorthandAssign = this.start
      prop.value = this.parseMaybeDefault(startPos, startLoc, this.copyNode(prop.key))
    } else {
      prop.value = this.copyNode(prop.key)
    }
    prop.shorthand = true
  } else this.unexpected()
}

/**
 * 解析出prop变量, 如{ key: val}的key
 * @param {Node} prop 
 * @returns {Node}
 */
pp.parsePropertyName = function(prop) {
  if (this.options.ecmaVersion >= 6) {
    if (this.eat(tt.bracketL)) {
      // { [aaa= 'bbb']: 21 }
      prop.computed = true
      prop.key = this.parseMaybeAssign() // 解析[]中的key值
      this.expect(tt.bracketR)
      return prop.key
    } else {
      prop.computed = false
    }
  }
  return prop.key = this.type === tt.num || this.type === tt.string ?
    this.parseExprAtom() // 解析表达式
    :
    this.parseIdent(this.options.allowReserved !== "never") // 解析单个变量
}

// Initialize empty function node.

/**
 * 初始化function的node
 */
pp.initFunction = function(node) {
  node.id = null
  if (this.options.ecmaVersion >= 6) node.generator = node.expression = false
  if (this.options.ecmaVersion >= 8) node.async = false
}

// Parse object or class method.
/**
 * 解析object或者class 方法, 在parseObj或者parseClassMethod中调用
 * @param {*} isGenerator 
 * @param {*} isAsync 
 * @param {*} allowDirectSuper 
 * @returns 
 */
pp.parseMethod = function(isGenerator, isAsync, allowDirectSuper) {
  let node = this.startNode(), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos

  this.initFunction(node)
  if (this.options.ecmaVersion >= 6)
    node.generator = isGenerator
  if (this.options.ecmaVersion >= 8)
    node.async = !!isAsync

  this.yieldPos = 0
  this.awaitPos = 0
  this.awaitIdentPos = 0
  this.enterScope(functionFlags(isAsync, node.generator) | SCOPE_SUPER | (allowDirectSuper ? SCOPE_DIRECT_SUPER : 0))

  this.expect(tt.parenL)
  node.params = this.parseBindingList(tt.parenR, false, this.options.ecmaVersion >= 8)
  this.checkYieldAwaitInDefaultParams()
  this.parseFunctionBody(node, false, true, false)

  this.yieldPos = oldYieldPos
  this.awaitPos = oldAwaitPos
  this.awaitIdentPos = oldAwaitIdentPos
  return this.finishNode(node, "FunctionExpression")
}

// Parse arrow function expression with given parameters.
/**
 * 解析箭头函数
 * @param {Node} node 
 * @param {*} params 
 * @param {*} isAsync 
 * @param {*} forInit 
 * @returns 
 */
pp.parseArrowExpression = function(node, params, isAsync, forInit) {
  let oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos

  this.enterScope(functionFlags(isAsync, false) | SCOPE_ARROW)
  this.initFunction(node)
  if (this.options.ecmaVersion >= 8) node.async = !!isAsync

  this.yieldPos = 0
  this.awaitPos = 0
  this.awaitIdentPos = 0

  node.params = this.toAssignableList(params, true)
  this.parseFunctionBody(node, true, false, forInit)

  this.yieldPos = oldYieldPos
  this.awaitPos = oldAwaitPos
  this.awaitIdentPos = oldAwaitIdentPos
  return this.finishNode(node, "ArrowFunctionExpression")
}

// Parse function body and check parameters.

/**
 * 解析函数执行体.  设置到node.body
 * @param {*} node 
 * @param {boolean} isArrowFunction 
 * @param {boolean} isMethod 
 * @param {*} forInit 
 */
pp.parseFunctionBody = function(node, isArrowFunction, isMethod, forInit) {
  let isExpression = isArrowFunction && this.type !== tt.braceL
  let oldStrict = this.strict, useStrict = false

  if (isExpression) {
    node.body = this.parseMaybeAssign(forInit)
    node.expression = true
    this.checkParams(node, false)
  } else {
    let nonSimple = this.options.ecmaVersion >= 7 && !this.isSimpleParamList(node.params)
    if (!oldStrict || nonSimple) {
      useStrict = this.strictDirective(this.end)
      // If this is a strict mode function, verify that argument names
      // are not repeated, and it does not try to bind the words `eval`
      // or `arguments`.
      if (useStrict && nonSimple)
        this.raiseRecoverable(node.start, "Illegal 'use strict' directive in function with non-simple parameter list")
    }
    // Start a new scope with regard to labels and the `inFunction`
    // flag (restore them to their old value afterwards).
    let oldLabels = this.labels
    this.labels = []
    if (useStrict) this.strict = true

    // Add the params to varDeclaredNames to ensure that an error is thrown
    // if a let/const declaration in the function clashes with one of the params.
    this.checkParams(node, !oldStrict && !useStrict && !isArrowFunction && !isMethod && this.isSimpleParamList(node.params))
    // Ensure the function name isn't a forbidden identifier in strict mode, e.g. 'eval'
    if (this.strict && node.id) this.checkLValSimple(node.id, BIND_OUTSIDE)
    node.body = this.parseBlock(false, undefined, useStrict && !oldStrict)
    node.expression = false
    this.adaptDirectivePrologue(node.body.body)
    this.labels = oldLabels
  }
  this.exitScope()
}

pp.isSimpleParamList = function(params) {
  for (let param of params)
    if (param.type !== "Identifier") return false
  return true
}

// Checks function params for various disallowed patterns such as using "eval"
// or "arguments" and duplicate parameters.

pp.checkParams = function(node, allowDuplicates) {
  let nameHash = Object.create(null)
  for (let param of node.params)
    this.checkLValInnerPattern(param, BIND_VAR, allowDuplicates ? null : nameHash)
}

// Parses a comma-separated list of expressions, and returns them as
// an array. `close` is the token type that ends the list, and
// `allowEmpty` can be turned on to allow subsequent commas with
// nothing in between them to be parsed as `null` (which is needed
// for array literals).
/**
 * 解析一组表达式列表
 * @param {TokenType} close 停止符
 * @param {boolean} allowTrailingComma 
 * @param {boolean} allowEmpty 
 * @param {*} refDestructuringErrors 
 * @returns {Node[]}
 */
pp.parseExprList = function(close, allowTrailingComma, allowEmpty, refDestructuringErrors) {
  let elts = [], first = true
  while (!this.eat(close)) {
    if (!first) {
      this.expect(tt.comma)
      if (allowTrailingComma && this.afterTrailingComma(close)) break
    } else first = false

    let elt
    if (allowEmpty && this.type === tt.comma)
      elt = null
    else if (this.type === tt.ellipsis) {
      elt = this.parseSpread(refDestructuringErrors)
      if (refDestructuringErrors && this.type === tt.comma && refDestructuringErrors.trailingComma < 0)
        refDestructuringErrors.trailingComma = this.start
    } else {
      elt = this.parseMaybeAssign(false, refDestructuringErrors)
    }
    elts.push(elt)
  }
  return elts
}

/**
 * 检查变量名合法性
 * @returns 
 */
pp.checkUnreserved = function({start, end, name}) {
  if (this.inGenerator && name === "yield")
    this.raiseRecoverable(start, "Cannot use 'yield' as identifier inside a generator")
  if (this.inAsync && name === "await")
    this.raiseRecoverable(start, "Cannot use 'await' as identifier inside an async function")
  if (this.currentThisScope().inClassFieldInit && name === "arguments")
    this.raiseRecoverable(start, "Cannot use 'arguments' in class field initializer")
  if (this.inClassStaticBlock && (name === "arguments" || name === "await"))
    this.raise(start, `Cannot use ${name} in class static initialization block`)
  if (this.keywords.test(name))
    this.raise(start, `Unexpected keyword '${name}'`)
  if (this.options.ecmaVersion < 6 &&
    this.input.slice(start, end).indexOf("\\") !== -1) return
  const re = this.strict ? this.reservedWordsStrict : this.reservedWords
  if (re.test(name)) {
    if (!this.inAsync && name === "await")
      this.raiseRecoverable(start, "Cannot use keyword 'await' outside an async function")
    this.raiseRecoverable(start, `The keyword '${name}' is reserved`)
  }
}

// Parse the next token as an identifier. If `liberal` is true (used
// when parsing properties), it will also convert keywords into
// identifiers.
/**
 * 解析当前token并作为变量类型返回
 * @param {boolean} liberal 是否解析properties
 * @param {boolean} isBinding 
 * @returns 
 */
pp.parseIdent = function(liberal, isBinding) {
  let node = this.startNode()
  if (this.type === tt.name) {
    node.name = this.value
  } else if (this.type.keyword) {
    node.name = this.type.keyword

    // To fix https://github.com/acornjs/acorn/issues/575
    // `class` and `function` keywords push new context into this.context.
    // But there is no chance to pop the context if the keyword is consumed as an identifier such as a property name.
    // If the previous token is a dot, this does not apply because the context-managing code already ignored the keyword
    if ((node.name === "class" || node.name === "function") &&
        (this.lastTokEnd !== this.lastTokStart + 1 || this.input.charCodeAt(this.lastTokStart) !== 46)) { // 46 .
      this.context.pop()
    }
  } else {
    this.unexpected()
  }
  this.next(!!liberal)
  this.finishNode(node, "Identifier")
  if (!liberal) {
    this.checkUnreserved(node)
    if (node.name === "await" && !this.awaitIdentPos)
      this.awaitIdentPos = node.start
  }
  return node
}

/**
 * 解析#开头的私有变量, 并插入到privateNameStack中
 * @returns 
 */
pp.parsePrivateIdent = function() {
  const node = this.startNode()
  if (this.type === tt.privateId) {
    node.name = this.value
  } else {
    this.unexpected()
  }
  this.next()
  this.finishNode(node, "PrivateIdentifier")

  // For validating existence
  if (this.privateNameStack.length === 0) {
    this.raise(node.start, `Private field '#${node.name}' must be declared in an enclosing class`)
  } else {
    this.privateNameStack[this.privateNameStack.length - 1].used.push(node)
  }

  return node
}

// Parses yield expression inside generator.
/**
 * parseMaybeAssign中调用
 * @param {*} forInit 
 * @returns 
 */
pp.parseYield = function(forInit) {
  if (!this.yieldPos) this.yieldPos = this.start

  let node = this.startNode()
  this.next()
  if (this.type === tt.semi || this.canInsertSemicolon() || (this.type !== tt.star && !this.type.startsExpr)) {
    node.delegate = false
    node.argument = null
  } else {
    node.delegate = this.eat(tt.star)
    node.argument = this.parseMaybeAssign(forInit)
  }
  return this.finishNode(node, "YieldExpression")
}

/**
 * parseMaybeUnary中调用
 * 如await aaa()或者await promise, 返回AwaitExpression, 并将调用的内容使用parseMaybeUnary解析出来设置为argument
 * @param {*} forInit 
 * @returns 
 */
pp.parseAwait = function(forInit) {
  if (!this.awaitPos) this.awaitPos = this.start

  let node = this.startNode()
  this.next()
  node.argument = this.parseMaybeUnary(null, true, false, forInit)
  return this.finishNode(node, NodeTypes.AwaitExpression)
}
