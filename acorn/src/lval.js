import {NodeTypes, types as tt} from "./tokentype.js"
import {Parser} from "./state.js"
import {hasOwn} from "./util.js"
import {BIND_NONE, BIND_OUTSIDE, BIND_LEXICAL} from "./scopeflags.js"

const pp = Parser.prototype

// Convert existing expression atom to assignable pattern
// if possible.
/**
 * 检查合法性, 并修正一下某些type类型
 * @param {Node} node 
 * @param {boolean} isBinding 
 * @param {Error} refDestructuringErrors 
 * @returns 
 */
pp.toAssignable = function(node, isBinding, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 6 && node) {
    switch (node.type) {
    case "Identifier":
      if (this.inAsync && node.name === "await") // 如果是在async内部, 不可以用await作为变量名
        this.raise(node.start, "Cannot use 'await' as identifier inside an async function")
      break

    case "ObjectPattern":
    case "ArrayPattern":
    case "AssignmentPattern":
    case "RestElement":
      break

    case "ObjectExpression": // {a,b}这种类型
      node.type = "ObjectPattern"
      if (refDestructuringErrors) this.checkPatternErrors(refDestructuringErrors, true)
      for (let prop of node.properties) { // properties应该是分配的变量
        this.toAssignable(prop, isBinding) // 递归调用检查
        // Early error:
        //   AssignmentRestProperty[Yield, Await] :
        //     `...` DestructuringAssignmentTarget[Yield, Await]
        //
        //   It is a Syntax Error if |DestructuringAssignmentTarget| is an |ArrayLiteral| or an |ObjectLiteral|.
        if (
          prop.type === "RestElement" &&
          (prop.argument.type === "ArrayPattern" || prop.argument.type === "ObjectPattern")
        ) {
          this.raise(prop.argument.start, "Unexpected token")
        }
      }
      break
    // a.b这种类型
    case "Property":
      // AssignmentProperty has type === "Property"
      if (node.kind !== "init") this.raise(node.key.start, "Object pattern can't contain getter or setter")
      this.toAssignable(node.value, isBinding)
      break
    // [a,b] 这种类型
    case "ArrayExpression":
      node.type = "ArrayPattern"
      if (refDestructuringErrors) this.checkPatternErrors(refDestructuringErrors, true)
      this.toAssignableList(node.elements, isBinding)
      break

    case "SpreadElement": // ...
      node.type = "RestElement"
      this.toAssignable(node.argument, isBinding)
      if (node.argument.type === "AssignmentPattern")
        this.raise(node.argument.start, "Rest elements cannot have a default value")
      break
    // a = b 
    case "AssignmentExpression":
      if (node.operator !== "=") this.raise(node.left.end, "Only '=' operator can be used for specifying default value.")
      node.type = "AssignmentPattern"
      delete node.operator
      this.toAssignable(node.left, isBinding)
      break

    case "ParenthesizedExpression":
      this.toAssignable(node.expression, isBinding, refDestructuringErrors)
      break

    case "ChainExpression":
      this.raiseRecoverable(node.start, "Optional chaining cannot appear in left-hand side")
      break

    case "MemberExpression":
      if (!isBinding) break

    default:
      this.raise(node.start, "Assigning to rvalue")
    }
  } else if (refDestructuringErrors) this.checkPatternErrors(refDestructuringErrors, true)
  return node
}

// Convert list of expression atoms to binding list.
/** 对列表执行toAssignable */
pp.toAssignableList = function(exprList, isBinding) {
  let end = exprList.length
  for (let i = 0; i < end; i++) {
    let elt = exprList[i]
    if (elt) this.toAssignable(elt, isBinding)
  }
  if (end) {
    let last = exprList[end - 1]
    if (this.options.ecmaVersion === 6 && isBinding && last && last.type === "RestElement" && last.argument.type !== "Identifier")
      this.unexpected(last.argument.start)
  }
  return exprList
}

// Parses spread element.
/** ...解构, 如let a = [...c], 只在`parseExprList`中调用 */
pp.parseSpread = function(refDestructuringErrors) {
  let node = this.startNode()
  this.next()
  node.argument = this.parseMaybeAssign(false, refDestructuringErrors)
  return this.finishNode(node, NodeTypes.SpreadElement)
}

/** ...解构赋值, 如 let [...aaa] = bbb; */
pp.parseRestBinding = function() {
  let node = this.startNode()
  this.next()

  // RestElement inside of a function parameter must be an identifier
  if (this.options.ecmaVersion === 6 && this.type !== tt.name)
    this.unexpected()

  node.argument = this.parseBindingAtom()
  return this.finishNode(node, NodeTypes.RestElement)
}

// Parses lvalue (assignable) atom.
/**
 * 解析单个变量或表达式, 如let [a,b], {c, d}, e
 * @returns {Node}
 */
pp.parseBindingAtom = function() {
  if (this.options.ecmaVersion >= 6) {
    switch (this.type) {
    case tt.bracketL: // [a,b]
      let node = this.startNode()
      this.next()
      node.elements = this.parseBindingList(tt.bracketR, true, true)
      return this.finishNode(node, NodeTypes.ArrayPattern) // 待赋值属性使用

    case tt.braceL: // {c, d}
      return this.parseObj(true)
    }
  }
  return this.parseIdent() // e
}

/**
 * 在let [a,b] = c 这种赋值语句中使用, 也可以是function (a,b){}这种语句中
 * 连续解析多个node, 直到遇到close, 然后返回解析到的node
 * @param {TokenType} close 预期读到的结束符
 * @param {boolean} allowEmpty 
 * @param {boolean} allowTrailingComma 是否允许以逗号结尾
 * @returns 
 */
pp.parseBindingList = function(close, allowEmpty, allowTrailingComma) {
  let elts = [], first = true
  while (!this.eat(close)) {
    if (first) first = false
    else this.expect(tt.comma) // 如果不是第一个, 则预期遇到逗号
    if (allowEmpty && this.type === tt.comma) {
      // 类似[a,,b]这种中间有空白的
      elts.push(null)
    } else if (allowTrailingComma && this.afterTrailingComma(close)) {
      // [a,b,]这种逗号后遇到结束符
      break
    } else if (this.type === tt.ellipsis) {
      // ...收集符
      let rest = this.parseRestBinding()
      this.parseBindingListItem(rest)
      elts.push(rest)
      // 收集符后不允许再有逗号
      if (this.type === tt.comma) this.raise(this.start, "Comma is not permitted after the rest element")
      this.expect(close)
      break
    } else {
      // 如let [a = 1] = [2]这种有默认值
      let elem = this.parseMaybeDefault(this.start, this.startLoc)
      this.parseBindingListItem(elem)
      elts.push(elem)
    }
  }
  return elts
}

pp.parseBindingListItem = function(param) {
  return param
}

// Parses assignment pattern around given atom if possible.
/**
 * 解析单个变量, 同时兼容 a = 1这种有默认值的情况
 * @param {*} startPos 
 * @param {*} startLoc 
 * @param {*} left 
 * @returns 
 */
pp.parseMaybeDefault = function(startPos, startLoc, left) {
  left = left || this.parseBindingAtom()
  if (this.options.ecmaVersion < 6 || !this.eat(tt.eq)) return left
  let node = this.startNodeAt(startPos, startLoc)
  node.left = left
  node.right = this.parseMaybeAssign()
  return this.finishNode(node, NodeTypes.AssignmentPattern)
}

// The following three functions all verify that a node is an lvalue —
// something that can be bound, or assigned to. In order to do so, they perform
// a variety of checks:
//
// - Check that none of the bound/assigned-to identifiers are reserved words.
// - Record name declarations for bindings in the appropriate scope.
// - Check duplicate argument names, if checkClashes is set.
//
// If a complex binding pattern is encountered (e.g., object and array
// destructuring), the entire pattern is recursively checked.
//
// There are three versions of checkLVal*() appropriate for different
// circumstances:
//
// - checkLValSimple() shall be used if the syntactic construct supports
//   nothing other than identifiers and member expressions. Parenthesized
//   expressions are also correctly handled. This is generally appropriate for
//   constructs for which the spec says
//
//   > It is a Syntax Error if AssignmentTargetType of [the production] is not
//   > simple.
//
//   It is also appropriate for checking if an identifier is valid and not
//   defined elsewhere, like import declarations or function/class identifiers.
//
//   Examples where this is used include:
//     a += …;
//     import a from '…';
//   where a is the node to be checked.
//
// - checkLValPattern() shall be used if the syntactic construct supports
//   anything checkLValSimple() supports, as well as object and array
//   destructuring patterns. This is generally appropriate for constructs for
//   which the spec says
//
//   > It is a Syntax Error if [the production] is neither an ObjectLiteral nor
//   > an ArrayLiteral and AssignmentTargetType of [the production] is not
//   > simple.
//
//   Examples where this is used include:
//     (a = …);
//     const a = …;
//     try { … } catch (a) { … }
//   where a is the node to be checked.
//
// - checkLValInnerPattern() shall be used if the syntactic construct supports
//   anything checkLValPattern() supports, as well as default assignment
//   patterns, rest elements, and other constructs that may appear within an
//   object or array destructuring pattern.
//
//   As a special case, function parameters also use checkLValInnerPattern(),
//   as they also support defaults and rest constructs.
//
// These functions deliberately support both assignment and binding constructs,
// as the logic for both is exceedingly similar. If the node is the target of
// an assignment, then bindingType should be set to BIND_NONE. Otherwise, it
// should be set to the appropriate BIND_* constant, like BIND_VAR or
// BIND_LEXICAL.
//
// If the function is called with a non-BIND_NONE bindingType, then
// additionally a checkClashes object may be specified to allow checking for
// duplicate argument names. checkClashes is ignored if the provided construct
// is an assignment (i.e., bindingType is BIND_NONE).
/**
 * 检查合法性
 * @param {Node} expr 
 * @param {*} bindingType 
 * @param {*} checkClashes 
 * @returns 
 */
pp.checkLValSimple = function(expr, bindingType = BIND_NONE, checkClashes) {
  const isBind = bindingType !== BIND_NONE

  switch (expr.type) {
  case "Identifier":
    if (this.strict && this.reservedWordsStrictBind.test(expr.name))
      this.raiseRecoverable(expr.start, (isBind ? "Binding " : "Assigning to ") + expr.name + " in strict mode")
    if (isBind) {
      if (bindingType === BIND_LEXICAL && expr.name === "let")
        this.raiseRecoverable(expr.start, "let is disallowed as a lexically bound name")
      if (checkClashes) {
        if (hasOwn(checkClashes, expr.name))
          this.raiseRecoverable(expr.start, "Argument name clash")
        checkClashes[expr.name] = true
      }
      if (bindingType !== BIND_OUTSIDE) this.declareName(expr.name, bindingType, expr.start)
    }
    break

  case "ChainExpression":
    this.raiseRecoverable(expr.start, "Optional chaining cannot appear in left-hand side")
    break

  case "MemberExpression":
    if (isBind) this.raiseRecoverable(expr.start, "Binding member expression")
    break

  case "ParenthesizedExpression":
    if (isBind) this.raiseRecoverable(expr.start, "Binding parenthesized expression")
    return this.checkLValSimple(expr.expression, bindingType, checkClashes)

  default:
    this.raise(expr.start, (isBind ? "Binding" : "Assigning to") + " rvalue")
  }
}

/**
 * 检查赋值表达式合法性
 * @param {Node} expr 
 * @param {number} bindingType 
 * @param {boolean} checkClashes 
 */
pp.checkLValPattern = function(expr, bindingType = BIND_NONE, checkClashes) {
  switch (expr.type) {
  case "ObjectPattern":
    for (let prop of expr.properties) {
      this.checkLValInnerPattern(prop, bindingType, checkClashes)
    }
    break

  case "ArrayPattern":
    for (let elem of expr.elements) {
      if (elem) this.checkLValInnerPattern(elem, bindingType, checkClashes)
    }
    break

  default:
    this.checkLValSimple(expr, bindingType, checkClashes)
  }
}

pp.checkLValInnerPattern = function(expr, bindingType = BIND_NONE, checkClashes) {
  switch (expr.type) {
  case "Property":
    // AssignmentProperty has type === "Property"
    this.checkLValInnerPattern(expr.value, bindingType, checkClashes)
    break

  case "AssignmentPattern":
    this.checkLValPattern(expr.left, bindingType, checkClashes)
    break

  case "RestElement":
    this.checkLValPattern(expr.argument, bindingType, checkClashes)
    break

  default:
    this.checkLValPattern(expr, bindingType, checkClashes)
  }
}
