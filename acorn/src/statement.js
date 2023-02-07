import {NodeTypes, types as tt} from "./tokentype.js"
import {Parser} from "./state.js"
import {lineBreak, skipWhiteSpace} from "./whitespace.js"
import {isIdentifierStart, isIdentifierChar, keywordRelationalOperator} from "./identifier.js"
import {hasOwn, loneSurrogate} from "./util.js"
import { DestructuringErrors } from "./parseutil.js"
import { Node } from "./node";
import {functionFlags, SCOPE_SIMPLE_CATCH, BIND_SIMPLE_CATCH, BIND_LEXICAL, BIND_VAR, BIND_FUNCTION, SCOPE_CLASS_STATIC_BLOCK, SCOPE_SUPER} from "./scopeflags.js"

const pp = Parser.prototype

// ### Statement parsing

// Parse a program. Initializes the parser, reads any number of
// statements, and wraps them in a Program node.  Optionally takes a
// `program` argument.  If present, the statements will be appended
// to its body instead of creating a new node.
/**
 * parse的入口函数, 解析出program的node.
 * @param {Node} node 
 * @returns {Node}
 */
pp.parseTopLevel = function(node) {
  let exports = Object.create(null)
  if (!node.body) node.body = []
  while (this.type !== tt.eof) {
    let stmt = this.parseStatement(null, true, exports)
    node.body.push(stmt)
  }
  if (this.inModule)
    // undefined exports在checkLocalExport时插入, 如果是没有定义的本地变量, 则报错.
    for (let name of Object.keys(this.undefinedExports))
      this.raiseRecoverable(this.undefinedExports[name].start, `Export '${name}' is not defined`)
  this.adaptDirectivePrologue(node.body)
  this.next()
  node.sourceType = this.options.sourceType
  return this.finishNode(node, NodeTypes.Program)
}

/** 定义类型 */
const loopLabel = {kind: "loop"}, switchLabel = {kind: "switch"}

/**
 * 判断是否let表达式, 此时TokenType为name
 * let和var, const不一样, 单独处理
 * @param {any} context
 * */
pp.isLet = function(context) {
  if (this.options.ecmaVersion < 6 || !this.isContextual("let")) return false
  skipWhiteSpace.lastIndex = this.pos
  let skip = skipWhiteSpace.exec(this.input)
  // 获取到下一个变量
  let next = this.pos + skip[0].length, nextCh = this.input.charCodeAt(next)
  // For ambiguous cases, determine if a LexicalDeclaration (or only a
  // Statement) is allowed here. If context is not empty then only a Statement
  // is allowed. However, `let [` is an explicit negative lookahead for
  // ExpressionStatement, so special-case it first.
  if (nextCh === 91 || nextCh === 92) return true // '[', '/'
  if (context) return false

  if (nextCh === 123 || nextCh > 0xd7ff && nextCh < 0xdc00) return true // '{', astral
  if (isIdentifierStart(nextCh, true)) {
    let pos = next + 1
    while (isIdentifierChar(nextCh = this.input.charCodeAt(pos), true)) ++pos
    if (nextCh === 92 || nextCh > 0xd7ff && nextCh < 0xdc00) return true
    let ident = this.input.slice(next, pos)
    if (!keywordRelationalOperator.test(ident)) return true
  }
  return false
}

// check 'async [no LineTerminator here] function'
// - 'async /*foo*/ function' is OK.
// - 'async /*\n*/ function' is invalid.
// 校验async 和function中间不可以有换行符
pp.isAsyncFunction = function() {
  if (this.options.ecmaVersion < 8 || !this.isContextual("async"))
    return false

  skipWhiteSpace.lastIndex = this.pos
  let skip = skipWhiteSpace.exec(this.input)
  let next = this.pos + skip[0].length, after
  return !lineBreak.test(this.input.slice(this.pos, next)) &&
    this.input.slice(next, next + 8) === "function" &&
    (next + 8 === this.input.length ||
     !(isIdentifierChar(after = this.input.charCodeAt(next + 8)) || after > 0xd7ff && after < 0xdc00))
}

// Parse a single statement.
//
// If expecting a statement and finding a slash operator, parse a
// regular expression literal. This is to handle cases like
// `if (foo) /blah/.exec(foo)`, where looking at the previous token
// does not help.

/**
 * 解析单个statement
 * 比如`class node {}`, `let n = new node();`, `const num = 1`都是一个单独的statement
 * 所以区分的方式是分号, 换行, 或者大括号
 * @param {null | string} context 作用在于判断上层类型.
 * @param {boolean} topLevel 
 * @param {Record<string, unknown>} exports 
 * @returns {Node}
 */
pp.parseStatement = function(context, topLevel, exports) {
  let starttype = this.type, node = this.startNode(), kind

  if (this.isLet(context)) {
    // 如果是let表达式, tokenType转换为var
    starttype = tt._var
    kind = "let"
  }

  // Most types of statements are recognized by the keyword they
  // start with. Many are trivial to parse, some require a bit of
  // complexity.

  switch (starttype) {
  case tt._break: case tt._continue: return this.parseBreakContinueStatement(node, starttype.keyword)
  case tt._debugger: return this.parseDebuggerStatement(node)
  case tt._do: return this.parseDoStatement(node)
  case tt._for: return this.parseForStatement(node)
  case tt._function:
    // Function as sole body of either an if statement or a labeled statement
    // works, but not when it is part of a labeled statement that is the sole
    // body of an if statement.
    if ((context && (this.strict || context !== "if" && context !== "label")) && this.options.ecmaVersion >= 6) this.unexpected()
    return this.parseFunctionStatement(node, false, !context)
  case tt._class:
    if (context) this.unexpected()
    return this.parseClass(node, true)
  case tt._if: return this.parseIfStatement(node)
  case tt._return: return this.parseReturnStatement(node)
  case tt._switch: return this.parseSwitchStatement(node)
  case tt._throw: return this.parseThrowStatement(node)
  case tt._try: return this.parseTryStatement(node)
  case tt._const: case tt._var:
    kind = kind || this.value
    if (context && kind !== "var") this.unexpected()
    return this.parseVarStatement(node, kind)
  case tt._while: return this.parseWhileStatement(node)
  case tt._with: return this.parseWithStatement(node)
  case tt.braceL: return this.parseBlock(true, node)
  case tt.semi: return this.parseEmptyStatement(node)
  case tt._export:
  case tt._import:
    if (this.options.ecmaVersion > 10 && starttype === tt._import) {
      skipWhiteSpace.lastIndex = this.pos
      let skip = skipWhiteSpace.exec(this.input)
      let next = this.pos + skip[0].length, nextCh = this.input.charCodeAt(next)
      if (nextCh === 40 || nextCh === 46) // '(' or '.'
        return this.parseExpressionStatement(node, this.parseExpression())
    }

    if (!this.options.allowImportExportEverywhere) {
      if (!topLevel)
        this.raise(this.start, "'import' and 'export' may only appear at the top level")
      if (!this.inModule)
        this.raise(this.start, "'import' and 'export' may appear only with 'sourceType: module'")
    }
    return starttype === tt._import ? this.parseImport(node) : this.parseExport(node, exports)

    // If the statement does not start with a statement keyword or a
    // brace, it's an ExpressionStatement or LabeledStatement. We
    // simply start parsing an expression, and afterwards, if the
    // next token is a colon and the expression was a simple
    // Identifier node, we switch to interpreting it as a label.
  default:
    if (this.isAsyncFunction()) {
      if (context) this.unexpected()
      this.next()
      return this.parseFunctionStatement(node, true, !context) // 这里!context为true
    }

    let maybeName = this.value, expr = this.parseExpression()
    if (starttype === tt.name && expr.type === "Identifier" && this.eat(tt.colon))
      return this.parseLabeledStatement(node, maybeName, expr, context)
    else return this.parseExpressionStatement(node, expr)
  }
}

/**
 * 解析break或者continue
 * @param {Node} node 
 * @param {string} keyword 
 * @returns {Node}
 */
pp.parseBreakContinueStatement = function(node, keyword) {
  let isBreak = keyword === "break"
  this.next()
  if (this.eat(tt.semi) || this.insertSemicolon()) node.label = null
  else if (this.type !== tt.name) this.unexpected()
  else {
    node.label = this.parseIdent()
    this.semicolon()
  }

  // Verify that there is an actual destination to break or
  // continue to.
  let i = 0
  for (; i < this.labels.length; ++i) {
    let lab = this.labels[i]
    if (node.label == null || lab.name === node.label.name) {
      // 判断continue或break, 如果是continue, 则要求是循环
      if (lab.kind != null && (isBreak || lab.kind === "loop")) break
      // break 到label.name上, 这里可以不是循环
      if (node.label && isBreak) break
    }
  }
  if (i === this.labels.length) this.raise(node.start, "Unsyntactic " + keyword)
  return this.finishNode(node, isBreak ? NodeTypes.BreakStatement : NodeTypes.ContinueStatement)
}

/**
 * 
 * @param {Node} node 
 * @returns {Node}
 */
pp.parseDebuggerStatement = function(node) {
  this.next()
  this.semicolon()
  return this.finishNode(node, NodeTypes.DebuggerStatement)
}

/**
 * @param {Node} node 
 * @returns {Node}
 */
pp.parseDoStatement = function(node) {
  this.next()
  // 记录label用于break或continue
  this.labels.push(loopLabel)
  node.body = this.parseStatement("do")
  this.labels.pop()
  this.expect(tt._while)
  node.test = this.parseParenExpression()
  if (this.options.ecmaVersion >= 6)
    this.eat(tt.semi)
  else
    this.semicolon()
  return this.finishNode(node, NodeTypes.DoWhileStatement)
}

// Disambiguating between a `for` and a `for`/`in` or `for`/`of`
// loop is non-trivial. Basically, we have to parse the init `var`
// statement or expression, disallowing the `in` operator (see
// the second parameter to `parseExpression`), and then check
// whether the next token is `in` or `of`. When there is no init
// part (semicolon immediately after the opening parenthesis), it
// is a regular `for` loop.
/**
 * for循环有几种类型, 1 for-in 2 for-of 3 for(;;)
 * @param {Node} node 
 * @returns {Node}
 */
pp.parseForStatement = function(node) {
  this.next()
  // 判断第一个是否await
  let awaitAt = (this.options.ecmaVersion >= 9 && this.canAwait && this.eatContextual("await")) ? this.lastTokStart : -1
  this.labels.push(loopLabel)
  this.enterScope(0)
  this.expect(tt.parenL)
  if (this.type === tt.semi) {
    if (awaitAt > -1) this.unexpected(awaitAt)
    return this.parseFor(node, null)
  }
  let isLet = this.isLet()
  if (this.type === tt._var || this.type === tt._const || isLet) {
    // 默认情况下进入此分支
    let init = this.startNode(), kind = isLet ? "let" : this.value
    this.next()
    this.parseVar(init, true, kind)
    this.finishNode(init, NodeTypes.VariableDeclaration)
    if ((this.type === tt._in || (this.options.ecmaVersion >= 6 && this.isContextual("of"))) && init.declarations.length === 1) {
      if (this.options.ecmaVersion >= 9) {
        if (this.type === tt._in) {
          if (awaitAt > -1) this.unexpected(awaitAt)
          // https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/for-await...of
          // 在of迭代的时候, 允许await, for await (let xxx of xxxx)
        } else node.await = awaitAt > -1
      }
      return this.parseForIn(node, init)
    }
    if (awaitAt > -1) this.unexpected(awaitAt)
    return this.parseFor(node, init)
  }

  // https://github.com/acornjs/acorn/issues/1009
  // 极端情况
  let startsWithLet = this.isContextual("let"), isForOf = false
  // for (aaa of bbb)
  let refDestructuringErrors = new DestructuringErrors
  let init = this.parseExpression(awaitAt > -1 ? "await" : true, refDestructuringErrors)
  if (this.type === tt._in || (isForOf = this.options.ecmaVersion >= 6 && this.isContextual("of"))) {
    if (this.options.ecmaVersion >= 9) {
      if (this.type === tt._in) {
        if (awaitAt > -1) this.unexpected(awaitAt)
      } else node.await = awaitAt > -1
    }
    if (startsWithLet && isForOf) this.raise(init.start, "The left-hand side of a for-of loop may not start with 'let'.")
    this.toAssignable(init, false, refDestructuringErrors)
    this.checkLValPattern(init)
    return this.parseForIn(node, init)
  } else {
    this.checkExpressionErrors(refDestructuringErrors, true)
  }
  if (awaitAt > -1) this.unexpected(awaitAt)
  return this.parseFor(node, init)
}

/** 调用`parseFunction`得到返回值, context存在时, declarationPosition为true
 * 只有context为if或者label时为false, 否则为true
 * @param {boolean} declarationPosition
 */
pp.parseFunctionStatement = function(node, isAsync, declarationPosition) {
  this.next()
  return this.parseFunction(node, FUNC_STATEMENT | (declarationPosition ? 0 : FUNC_HANGING_STATEMENT), false, isAsync)
}

/**
 * 解析if语句表达式和内部运算块
 * 如if () {} else if () {} else {}
 * */
pp.parseIfStatement = function(node) {
  this.next()
  node.test = this.parseParenExpression()
  // allow function declarations in branches, but only in non-strict mode
  node.consequent = this.parseStatement("if")
  node.alternate = this.eat(tt._else) ? this.parseStatement("if") : null
  return this.finishNode(node, NodeTypes.IfStatement)
}

/** 解析return, 判断下一个token读到的是否分号, 如果不是则解析返回内容设置到argument上 */
pp.parseReturnStatement = function(node) {
  if (!this.inFunction && !this.options.allowReturnOutsideFunction)
    this.raise(this.start, "'return' outside of function")
  this.next()

  // In `return` (and `break`/`continue`), the keywords with
  // optional arguments, we eagerly look for a semicolon or the
  // possibility to insert one.

  if (this.eat(tt.semi) || this.insertSemicolon()) node.argument = null
  else { node.argument = this.parseExpression(); this.semicolon() }
  return this.finishNode(node, NodeTypes.ReturnStatement)
}

/**
 * 解析switch
 * @param {*} node 
 * @returns 
 */
pp.parseSwitchStatement = function(node) {
  this.next()
  node.discriminant = this.parseParenExpression()
  node.cases = []
  this.expect(tt.braceL)
  this.labels.push(switchLabel)
  this.enterScope(0)

  // Statements under must be grouped (by label) in SwitchCase
  // nodes. `cur` is used to keep the node that we are currently
  // adding statements to.

  let cur
  for (let sawDefault = false; this.type !== tt.braceR;) {
    if (this.type === tt._case || this.type === tt._default) {
      let isCase = this.type === tt._case
      if (cur) this.finishNode(cur, NodeTypes.SwitchCase)
      node.cases.push(cur = this.startNode())
      cur.consequent = []
      this.next()
      if (isCase) {
        cur.test = this.parseExpression()
      } else {
        if (sawDefault) this.raiseRecoverable(this.lastTokStart, "Multiple default clauses")
        sawDefault = true
        cur.test = null
      }
      this.expect(tt.colon)
    } else {
      if (!cur) this.unexpected()
      cur.consequent.push(this.parseStatement(null))
    }
  }
  this.exitScope()
  if (cur) this.finishNode(cur, NodeTypes.SwitchCase)
  this.next() // Closing brace
  this.labels.pop()
  return this.finishNode(node, NodeTypes.SwitchStatement)
}

/** 解析throw */
pp.parseThrowStatement = function(node) {
  this.next()
  if (lineBreak.test(this.input.slice(this.lastTokEnd, this.start)))
    this.raise(this.lastTokEnd, "Illegal newline after throw")
  node.argument = this.parseExpression()
  this.semicolon()
  return this.finishNode(node, NodeTypes.ThrowStatement)
}

// Reused empty array added for node fields that are always empty.

const empty = []

/** 解析try catch */
pp.parseTryStatement = function(node) {
  this.next()
  node.block = this.parseBlock()
  node.handler = null
  if (this.type === tt._catch) {
    let clause = this.startNode()
    this.next()
    if (this.eat(tt.parenL)) {
      clause.param = this.parseBindingAtom()
      let simple = clause.param.type === "Identifier"
      this.enterScope(simple ? SCOPE_SIMPLE_CATCH : 0)
      this.checkLValPattern(clause.param, simple ? BIND_SIMPLE_CATCH : BIND_LEXICAL)
      this.expect(tt.parenR)
    } else {
      if (this.options.ecmaVersion < 10) this.unexpected()
      clause.param = null
      this.enterScope(0)
    }
    clause.body = this.parseBlock(false)
    this.exitScope()
    node.handler = this.finishNode(clause, NodeTypes.CatchClause)
  }
  node.finalizer = this.eat(tt._finally) ? this.parseBlock() : null
  if (!node.handler && !node.finalizer)
    this.raise(node.start, "Missing catch or finally clause")
  return this.finishNode(node, NodeTypes.TryStatement)
}

/**
 * `let a = 1`定义赋值
 * @param {string} kind, 可能是let, const, var
 */
pp.parseVarStatement = function(node, kind) {
  this.next()
  // 调用parseVar解析等号左右
  this.parseVar(node, false, kind)
  // 尝试插入分号
  this.semicolon()
  return this.finishNode(node, NodeTypes.VariableDeclaration)
}

/**
 * while() {}
 * 解析while
 */
pp.parseWhileStatement = function(node) {
  this.next()
  node.test = this.parseParenExpression()
  this.labels.push(loopLabel)
  node.body = this.parseStatement("while")
  this.labels.pop()
  return this.finishNode(node, NodeTypes.WhileStatement)
}

/** 解析with, 这个用的少, 语法是
 * with (expression) {
    statement
  }
  'with'语句将某个对象添加到作用域链的顶部，如果在 statement 中有某个未使用命名空间的变量，跟作用域链中的某个属性同名，则这个变量将指向这个属性值
*/
pp.parseWithStatement = function(node) {
  if (this.strict) this.raise(this.start, "'with' in strict mode")
  this.next()
  node.object = this.parseParenExpression()
  node.body = this.parseStatement("with")
  return this.finishNode(node, NodeTypes.WithStatement)
}

/** 空内容, {} */
pp.parseEmptyStatement = function(node) {
  this.next()
  return this.finishNode(node, NodeTypes.EmptyStatement)
}

/**
 * 解析label的内容, label: statement
 * @param {Node} node 
 * @param {string} maybeName 
 * @param {Node} expr 
 * @param {string | null} context 
 * @returns 
 */
pp.parseLabeledStatement = function(node, maybeName, expr, context) {
  for (let label of this.labels)
    if (label.name === maybeName)
      this.raise(expr.start, "Label '" + maybeName + "' is already declared")
  let kind = this.type.isLoop ? "loop" : this.type === tt._switch ? "switch" : null
  for (let i = this.labels.length - 1; i >= 0; i--) {
    let label = this.labels[i]
    if (label.statementStart === node.start) {
      // 不明白为什么要更新这个
      // Update information about previous labels on this node
      label.statementStart = this.start
      label.kind = kind
    } else break
  }
  this.labels.push({name: maybeName, kind, statementStart: this.start})
  node.body = this.parseStatement(context ? context.indexOf("label") === -1 ? context + "label" : context : "label")
  this.labels.pop()
  node.label = expr
  return this.finishNode(node, NodeTypes.LabeledStatement)
}

/**
 * 类似 a = 1这种
 * @param {Node} node 
 * @param {Node} expr 
 * @returns 
 */
pp.parseExpressionStatement = function(node, expr) {
  node.expression = expr
  this.semicolon()
  return this.finishNode(node, NodeTypes.ExpressionStatement)
}

// Parse a semicolon-enclosed block of statements, handling `"use
// strict"` declarations when `allowStrict` is true (used for
// function bodies).
/**
 * 解析一个代码块,  即`{}`包起来的一组代码
 * @param {*} createNewLexicalScope 是否进入新作用域, 在catch或者function后为false
 * @param {*} node 
 * @param {*} exitStrict 只有在function后可能设为true
 * @returns 
 */
pp.parseBlock = function(createNewLexicalScope = true, node = this.startNode(), exitStrict) {
  node.body = []
  this.expect(tt.braceL)
  if (createNewLexicalScope) this.enterScope(0)
  while (this.type !== tt.braceR) {
    let stmt = this.parseStatement(null)
    node.body.push(stmt)
  }
  if (exitStrict) this.strict = false
  this.next()
  if (createNewLexicalScope) this.exitScope()
  return this.finishNode(node, NodeTypes.BlockStatement)
}

// Parse a regular `for` loop. The disambiguation code in
// `parseStatement` will already have parsed the init statement or
// expression.
/**
 * 解析for(init; test; update;) 循环
 * @param {Node} node 
 * @param {Node} init expression
 * @returns 
 */
pp.parseFor = function(node, init) {
  node.init = init
  this.expect(tt.semi)
  node.test = this.type === tt.semi ? null : this.parseExpression()
  this.expect(tt.semi)
  node.update = this.type === tt.parenR ? null : this.parseExpression()
  this.expect(tt.parenR)
  node.body = this.parseStatement("for")
  this.exitScope()
  this.labels.pop()
  return this.finishNode(node, NodeTypes.ForStatement)
}

// Parse a `for`/`in` and `for`/`of` loop, which are almost
// same from parser's perspective.
/**
 * 解析for-in for-of循环
 * @param {Node} node 
 * @param {Node} init 
 * @returns 
 */
pp.parseForIn = function(node, init) {
  const isForIn = this.type === tt._in
  this.next()

  // for (let i = 1 of bbb)
  if (
    init.type === "VariableDeclaration" &&
    init.declarations[0].init != null &&
    (
      !isForIn ||
      this.options.ecmaVersion < 8 ||
      this.strict ||
      init.kind !== "var" ||
      init.declarations[0].id.type !== "Identifier"
    )
  ) {
    this.raise(
      init.start,
      `${
        isForIn ? "for-in" : "for-of"
      } loop variable declaration may not have an initializer`
    )
  }
  node.left = init
  node.right = isForIn ? this.parseExpression() : this.parseMaybeAssign()
  this.expect(tt.parenR)
  node.body = this.parseStatement("for")
  this.exitScope()
  this.labels.pop()
  return this.finishNode(node, isForIn ? NodeTypes.ForInStatement : NodeTypes.ForOfStatement)
}

// Parse a list of variable declarations.
/**
 * 解析变量定义, 设置到declarations中, 返回Node
 * @param {Node} node 
 * @param {boolean} isFor 
 * @param {string} kind 'let','var','const'
 * @returns {Node}
 */
pp.parseVar = function(node, isFor, kind) {
  node.declarations = []
  node.kind = kind
  for (;;) {
    let decl = this.startNode()
    this.parseVarId(decl, kind)
    if (this.eat(tt.eq)) {
      decl.init = this.parseMaybeAssign(isFor)
    } else if (kind === "const" && !(this.type === tt._in || (this.options.ecmaVersion >= 6 && this.isContextual("of")))) {
      // const aaa += 这种形式报错
      this.unexpected()
    } else if (decl.id.type !== "Identifier" && !(isFor && (this.type === tt._in || this.isContextual("of")))) {
      this.raise(this.lastTokEnd, "Complex binding patterns require an initialization value")
    } else {
      decl.init = null
    }
    node.declarations.push(this.finishNode(decl, NodeTypes.VariableDeclarator))
    if (!this.eat(tt.comma)) break
  }
  return node
}

/**
 * 读出变量名, 设置到decl.id上
 * @param {Node} decl 
 * @param {string} kind 
 */
pp.parseVarId = function(decl, kind) {
  decl.id = this.parseBindingAtom()
  this.checkLValPattern(decl.id, kind === "var" ? BIND_VAR : BIND_LEXICAL, false)
}

const FUNC_STATEMENT = 1, FUNC_HANGING_STATEMENT /* context为if或者label */ = 2, FUNC_NULLABLE_ID = 4

// Parse a function declaration or literal (depending on the
// `statement & FUNC_STATEMENT`).

// Remove `allowExpressionBody` for 7.0.0, as it is only called with false
/**
 * 
 * @param {Node} node 
 * @param {number} statement 当前所在的statement, 在parseExprAtom中进入的时候为0
 * @param {boolean} allowExpressionBody 
 * @param {boolean} isAsync 
 * @param {*} forInit 
 * @returns 
 */
pp.parseFunction = function(node, statement, allowExpressionBody, isAsync, forInit) {
  this.initFunction(node)
  if (this.options.ecmaVersion >= 9 || this.options.ecmaVersion >= 6 && !isAsync) {
    if (this.type === tt.star && (statement & FUNC_HANGING_STATEMENT))
      this.unexpected()
    node.generator = this.eat(tt.star)
  }
  if (this.options.ecmaVersion >= 8)
    node.async = !!isAsync

  if (statement & FUNC_STATEMENT) {
    node.id = (statement & FUNC_NULLABLE_ID) && this.type !== tt.name ? null : this.parseIdent()
    if (node.id && !(statement & FUNC_HANGING_STATEMENT))
      // If it is a regular function declaration in sloppy mode, then it is
      // subject to Annex B semantics (BIND_FUNCTION). Otherwise, the binding
      // mode depends on properties of the current scope (see
      // treatFunctionsAsVar).
      this.checkLValSimple(node.id, (this.strict || node.generator || node.async) ? this.treatFunctionsAsVar ? BIND_VAR : BIND_LEXICAL : BIND_FUNCTION)
  }

  let oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos
  this.yieldPos = 0
  this.awaitPos = 0
  this.awaitIdentPos = 0
  this.enterScope(functionFlags(node.async, node.generator))

  if (!(statement & FUNC_STATEMENT))
    node.id = this.type === tt.name ? this.parseIdent() : null

  this.parseFunctionParams(node)
  this.parseFunctionBody(node, allowExpressionBody, false, forInit)

  this.yieldPos = oldYieldPos
  this.awaitPos = oldAwaitPos
  this.awaitIdentPos = oldAwaitIdentPos
  return this.finishNode(node, (statement & FUNC_STATEMENT) ? NodeTypes.FunctionDeclaration : NodeTypes.FunctionExpression)
}

/**
 * 调用parseBindingList读出函数的入参, 并设置到node.params上
 * @param {*} node 
 */
pp.parseFunctionParams = function(node) {
  this.expect(tt.parenL)
  node.params = this.parseBindingList(tt.parenR, false, this.options.ecmaVersion >= 8)
  this.checkYieldAwaitInDefaultParams()
}

// Parse a class declaration or literal (depending on the
// `isStatement` parameter).
/**
 * 解析class声明
 * @param {Node} node 
 * @param {boolean} isStatement 
 * @returns 
 */
pp.parseClass = function(node, isStatement) {
  this.next()

  // ecma-262 14.6 Class Definitions
  // A class definition is always strict mode code.
  const oldStrict = this.strict
  this.strict = true

  this.parseClassId(node, isStatement)
  this.parseClassSuper(node)
  const privateNameMap = this.enterClassBody()
  const classBody = this.startNode()
  let hadConstructor = false
  classBody.body = []
  this.expect(tt.braceL)
  while (this.type !== tt.braceR) {
    const element = this.parseClassElement(node.superClass !== null)
    if (element) {
      classBody.body.push(element)
      if (element.type === "MethodDefinition" && element.kind === "constructor") {
        if (hadConstructor) this.raise(element.start, "Duplicate constructor in the same class")
        hadConstructor = true
      } else if (element.key && element.key.type === "PrivateIdentifier" && isPrivateNameConflicted(privateNameMap, element)) {
        this.raiseRecoverable(element.key.start, `Identifier '#${element.key.name}' has already been declared`)
      }
    }
  }
  this.strict = oldStrict
  this.next()
  node.body = this.finishNode(classBody, NodeTypes.ClassBody)
  this.exitClassBody()
  return this.finishNode(node, isStatement ? NodeTypes.ClassDeclaration : NodeTypes.ClassExpression)
}

/**
 * 解析class中的成员.
 * @param {*} constructorAllowsSuper 
 * @returns 
 */
pp.parseClassElement = function(constructorAllowsSuper) {
  if (this.eat(tt.semi)) return null

  const ecmaVersion = this.options.ecmaVersion
  const node = this.startNode()
  let keyName = ""
  let isGenerator = false
  let isAsync = false
  let kind = "method"
  let isStatic = false

  if (this.eatContextual("static")) {
    // Parse static init block
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Static_initialization_blocks
    if (ecmaVersion >= 13 && this.eat(tt.braceL)) {
      this.parseClassStaticBlock(node)
      return node
    }
    if (this.isClassElementNameStart() || this.type === tt.star) {
      isStatic = true
    } else {
      keyName = "static"
    }
  }
  node.static = isStatic
  if (!keyName && ecmaVersion >= 8 && this.eatContextual("async")) {
    if ((this.isClassElementNameStart() || this.type === tt.star) && !this.canInsertSemicolon()) {
      isAsync = true
    } else {
      keyName = "async"
    }
  }
  if (!keyName && (ecmaVersion >= 9 || !isAsync) && this.eat(tt.star)) {
    isGenerator = true
  }
  if (!keyName && !isAsync && !isGenerator) {
    const lastValue = this.value
    if (this.eatContextual("get") || this.eatContextual("set")) {
      if (this.isClassElementNameStart()) {
        kind = lastValue
      } else {
        keyName = lastValue
      }
    }
  }

  // Parse element name
  if (keyName) {
    // 'async', 'get', 'set', or 'static' were not a keyword contextually.
    // The last token is any of those. Make it the element name.
    node.computed = false
    node.key = this.startNodeAt(this.lastTokStart, this.lastTokStartLoc)
    node.key.name = keyName
    this.finishNode(node.key, NodeTypes.Identifier)
  } else {
    this.parseClassElementName(node)
  }

  // Parse element value
  if (ecmaVersion < 13 || this.type === tt.parenL || kind !== "method" || isGenerator || isAsync) {
    const isConstructor = !node.static && checkKeyName(node, "constructor")
    const allowsDirectSuper = isConstructor && constructorAllowsSuper
    // Couldn't move this check into the 'parseClassMethod' method for backward compatibility.
    if (isConstructor && kind !== "method") this.raise(node.key.start, "Constructor can't have get/set modifier")
    node.kind = isConstructor ? "constructor" : kind
    this.parseClassMethod(node, isGenerator, isAsync, allowsDirectSuper)
  } else {
    this.parseClassField(node)
  }

  return node
}

/**
 * 判断是否合法的class的成员
 * @returns {boolean}
 */
pp.isClassElementNameStart = function() {
  return (
    this.type === tt.name ||
    this.type === tt.privateId ||
    this.type === tt.num ||
    this.type === tt.string ||
    this.type === tt.bracketL ||
    this.type.keyword
  )
}

/**
 * 解析class成员的名字
 * @param {*} element 
 */
pp.parseClassElementName = function (element) {
  if (this.type === tt.privateId) {
    if (this.value === "constructor") {
      this.raise(this.start, "Classes can't have an element named '#constructor'")
    }
    element.computed = false
    element.key = this.parsePrivateIdent()
  } else {
    this.parsePropertyName(element)
  }
}

/**
 * 解析class成员函数
 * @param {Node} method 
 * @param {*} isGenerator 
 * @param {*} isAsync 
 * @param {*} allowsDirectSuper 
 * @returns 
 */
pp.parseClassMethod = function(method, isGenerator, isAsync, allowsDirectSuper) {
  // Check key and flags
  const key = method.key
  if (method.kind === "constructor") {
    if (isGenerator) this.raise(key.start, "Constructor can't be a generator")
    if (isAsync) this.raise(key.start, "Constructor can't be an async method")
  } else if (method.static && checkKeyName(method, "prototype")) {
    this.raise(key.start, "Classes may not have a static property named prototype")
  }

  // Parse value
  const value = method.value = this.parseMethod(isGenerator, isAsync, allowsDirectSuper)

  // Check value
  if (method.kind === "get" && value.params.length !== 0)
    this.raiseRecoverable(value.start, "getter should have no params")
  if (method.kind === "set" && value.params.length !== 1)
    this.raiseRecoverable(value.start, "setter should have exactly one param")
  if (method.kind === "set" && value.params[0].type === "RestElement")
    this.raiseRecoverable(value.params[0].start, "Setter cannot use rest params")

  return this.finishNode(method, NodeTypes.MethodDefinition)
}

/**
 * 解析class成员变量定义
 * @param {Node} field 
 * @returns 
 */
pp.parseClassField = function(field) {
  if (checkKeyName(field, "constructor")) {
    this.raise(field.key.start, "Classes can't have a field named 'constructor'")
  } else if (field.static && checkKeyName(field, "prototype")) {
    this.raise(field.key.start, "Classes can't have a static field named 'prototype'")
  }

  if (this.eat(tt.eq)) {
    // To raise SyntaxError if 'arguments' exists in the initializer.
    const scope = this.currentThisScope()
    const inClassFieldInit = scope.inClassFieldInit
    scope.inClassFieldInit = true
    field.value = this.parseMaybeAssign()
    scope.inClassFieldInit = inClassFieldInit
  } else {
    field.value = null
  }
  this.semicolon()

  return this.finishNode(field, NodeTypes.PropertyDefinition)
}

/**
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Static_initialization_blocks
 * class 内部
 * static {} 这种语法
 * @param {*} node 
 * @returns 
 */
pp.parseClassStaticBlock = function(node) {
  node.body = []

  let oldLabels = this.labels
  this.labels = []
  this.enterScope(SCOPE_CLASS_STATIC_BLOCK | SCOPE_SUPER)
  while (this.type !== tt.braceR) {
    let stmt = this.parseStatement(null)
    node.body.push(stmt)
  }
  this.next()
  this.exitScope()
  this.labels = oldLabels

  return this.finishNode(node, NodeTypes.StaticBlock)
}

/**
 * 解析class name
 * @param {*} node 
 * @param {boolean} isStatement 
 */
pp.parseClassId = function(node, isStatement) {
  if (this.type === tt.name) {
    // class xxx { constructor(){} }
    node.id = this.parseIdent()
    if (isStatement)
      this.checkLValSimple(node.id, BIND_LEXICAL, false)
  } else {
    if (isStatement === true)
      this.unexpected()
    // let c = class { constructor(){} }
    node.id = null
  }
}

/**
 * 解析extends
 * @param {*} node 
 */
pp.parseClassSuper = function(node) {
  node.superClass = this.eat(tt._extends) ? this.parseExprSubscripts(false) : null
}

/**
 * 进入class时调用, 生成一个私有变量的保存对象, 并插入到栈上.
 * @returns 
 */
pp.enterClassBody = function() {
  const element = {declared: Object.create(null), used: []}
  this.privateNameStack.push(element)
  return element.declared
}

/**
 * 退出class时调用
 * 弹出前面的变量保存对象, 从used中循环, 如果当前成员组不存在, 则插入到父对象上的used中. 如果没有父对象, 则报错.
 */
pp.exitClassBody = function() {
  const {declared, used} = this.privateNameStack.pop()
  const len = this.privateNameStack.length
  const parent = len === 0 ? null : this.privateNameStack[len - 1]
  for (let i = 0; i < used.length; ++i) {
    const id = used[i]
    if (!hasOwn(declared, id.name)) {
      if (parent) {
        parent.used.push(id)
      } else {
        this.raiseRecoverable(id.start, `Private field '#${id.name}' must be declared in an enclosing class`)
      }
    }
  }
}

function isPrivateNameConflicted(privateNameMap, element) {
  const name = element.key.name
  const curr = privateNameMap[name]

  let next = "true"
  if (element.type === "MethodDefinition" && (element.kind === "get" || element.kind === "set")) {
    next = (element.static ? "s" : "i") + element.kind
  }

  // `class { get #a(){}; static set #a(_){} }` is also conflict.
  if (
    curr === "iget" && next === "iset" ||
    curr === "iset" && next === "iget" ||
    curr === "sget" && next === "sset" ||
    curr === "sset" && next === "sget"
  ) {
    privateNameMap[name] = "true"
    return false
  } else if (!curr) {
    privateNameMap[name] = next
    return false
  } else {
    return true
  }
}

function checkKeyName(node, name) {
  const {computed, key} = node
  return !computed && (
    key.type === "Identifier" && key.name === name ||
    key.type === "Literal" && key.value === name
  )
}

// Parses module export declaration.
/**
 * 解析export导出函数
 * @param {Node} node 
 * @param {Record<string, unknown>} exports 
 * @returns 
 */
pp.parseExport = function(node, exports) {
  this.next()
  // export * from '...'
  if (this.eat(tt.star)) {
    if (this.options.ecmaVersion >= 11) {
      if (this.eatContextual("as")) {
        node.exported = this.parseModuleExportName()
        this.checkExport(exports, node.exported, this.lastTokStart)
      } else {
        node.exported = null
      }
    }
    this.expectContextual("from")
    if (this.type !== tt.string) this.unexpected()
    node.source = this.parseExprAtom()
    this.semicolon()
    return this.finishNode(node, NodeTypes.ExportAllDeclaration)
  }
  if (this.eat(tt._default)) { // export default ...
    this.checkExport(exports, "default", this.lastTokStart)
    let isAsync
    if (this.type === tt._function || (isAsync = this.isAsyncFunction())) {
      let fNode = this.startNode()
      this.next()
      if (isAsync) this.next()
      node.declaration = this.parseFunction(fNode, FUNC_STATEMENT | FUNC_NULLABLE_ID, false, isAsync)
    } else if (this.type === tt._class) {
      let cNode = this.startNode()
      node.declaration = this.parseClass(cNode, "nullableID")
    } else {
      node.declaration = this.parseMaybeAssign()
      this.semicolon()
    }
    return this.finishNode(node, NodeTypes.ExportDefaultDeclaration)
  }
  // export var|const|let|function|class ...
  if (this.shouldParseExportStatement()) {
    node.declaration = this.parseStatement(null)
    if (node.declaration.type === "VariableDeclaration")
      this.checkVariableExport(exports, node.declaration.declarations)
    else
      this.checkExport(exports, node.declaration.id, node.declaration.id.start)
    node.specifiers = []
    node.source = null
  } else { // export { x, y as z } [from '...']
    node.declaration = null
    node.specifiers = this.parseExportSpecifiers(exports)
    if (this.eatContextual("from")) {
      if (this.type !== tt.string) this.unexpected()
      node.source = this.parseExprAtom()
    } else {
      for (let spec of node.specifiers) {
        // check for keywords used as local names
        this.checkUnreserved(spec.local)
        // check if export is defined
        this.checkLocalExport(spec.local)

        if (spec.local.type === "Literal") {
          this.raise(spec.local.start, "A string literal cannot be used as an exported binding without `from`.")
        }
      }

      node.source = null
    }
    this.semicolon()
  }
  return this.finishNode(node, NodeTypes.ExportNamedDeclaration)
}

/**
 * 检查exports是否重复了.
 * @param {Record<string, unknown>} exports 
 * @param {string | Node} name 
 * @param {Position} pos 
 * @returns 
 */
pp.checkExport = function(exports, name, pos) {
  if (!exports) return
  if (typeof name !== "string")
    name = name.type === "Identifier" ? name.name : name.value
  if (hasOwn(exports, name))
    this.raiseRecoverable(pos, "Duplicate export '" + name + "'")
  exports[name] = true
}

/**
 * 只在checkVariableExport调用, 递归调用到所有子节点
 * @param {Record<string, unknown>} exports 
 * @param {Node} pat 
 */
pp.checkPatternExport = function(exports, pat) {
  let type = pat.type
  if (type === "Identifier")
    this.checkExport(exports, pat, pat.start)
  else if (type === "ObjectPattern")
    for (let prop of pat.properties)
      this.checkPatternExport(exports, prop)
  else if (type === "ArrayPattern")
    for (let elt of pat.elements) {
      if (elt) this.checkPatternExport(exports, elt)
    }
  else if (type === "Property")
    this.checkPatternExport(exports, pat.value)
  else if (type === "AssignmentPattern")
    this.checkPatternExport(exports, pat.left)
  else if (type === "RestElement")
    this.checkPatternExport(exports, pat.argument)
  else if (type === "ParenthesizedExpression")
    this.checkPatternExport(exports, pat.expression)
}

/**
 * 循环判断列表中的node是否都已经导出
 * @param {*} exports 
 * @param {*} decls 
 * @returns 
 */
pp.checkVariableExport = function(exports, decls) {
  if (!exports) return
  for (let decl of decls)
    this.checkPatternExport(exports, decl.id)
}

/**
 * var|const|let|function|class
 * @returns 
 */
pp.shouldParseExportStatement = function() {
  return this.type.keyword === "var" ||
    this.type.keyword === "const" ||
    this.type.keyword === "class" ||
    this.type.keyword === "function" ||
    this.isLet() ||
    this.isAsyncFunction()
}

// Parses a comma-separated list of module exports.
/**
 * 读出待导出的变量
 * @param {Record<string, unknown>} exports 
 * @returns 
 */
pp.parseExportSpecifiers = function(exports) {
  let nodes = [], first = true
  // export { x, y as z } [from '...']
  this.expect(tt.braceL)
  while (!this.eat(tt.braceR)) {
    if (!first) {
      this.expect(tt.comma)
      if (this.afterTrailingComma(tt.braceR)) break
    } else first = false

    let node = this.startNode()
    node.local = this.parseModuleExportName()
    node.exported = this.eatContextual("as") ? this.parseModuleExportName() : node.local
    this.checkExport(
      exports,
      node.exported,
      node.exported.start
    )
    nodes.push(this.finishNode(node, NodeTypes.ExportSpecifier))
  }
  return nodes
}

// Parses import declaration.
/**
 * 
 * @param {Node} node 
 * @returns 
 */
pp.parseImport = function(node) {
  this.next()
  // import '...'
  if (this.type === tt.string) {
    node.specifiers = empty
    node.source = this.parseExprAtom()
  } else {
    node.specifiers = this.parseImportSpecifiers()
    this.expectContextual("from")
    node.source = this.type === tt.string ? this.parseExprAtom() : this.unexpected()
  }
  this.semicolon()
  return this.finishNode(node, NodeTypes.ImportDeclaration)
}

// Parses a comma-separated list of module imports.

pp.parseImportSpecifiers = function() {
  let nodes = [], first = true
  if (this.type === tt.name) {
    // import defaultObj, { x, y as z } from '...'
    let node = this.startNode()
    node.local = this.parseIdent()
    this.checkLValSimple(node.local, BIND_LEXICAL)
    nodes.push(this.finishNode(node, NodeTypes.ImportDefaultSpecifier))
    if (!this.eat(tt.comma)) return nodes
  }
  if (this.type === tt.star) {
    let node = this.startNode()
    this.next()
    this.expectContextual("as")
    node.local = this.parseIdent()
    this.checkLValSimple(node.local, BIND_LEXICAL)
    nodes.push(this.finishNode(node, NodeTypes.ImportNamespaceSpecifier))
    return nodes
  }
  this.expect(tt.braceL)
  while (!this.eat(tt.braceR)) {
    if (!first) {
      this.expect(tt.comma)
      if (this.afterTrailingComma(tt.braceR)) break
    } else first = false

    let node = this.startNode()
    node.imported = this.parseModuleExportName()
    if (this.eatContextual("as")) {
      node.local = this.parseIdent()
    } else {
      this.checkUnreserved(node.imported)
      node.local = node.imported
    }
    this.checkLValSimple(node.local, BIND_LEXICAL)
    nodes.push(this.finishNode(node, NodeTypes.ImportSpecifier))
  }
  return nodes
}

/**
 * 尝试解析export的变量名
 * @returns {Node}
 */
pp.parseModuleExportName = function() {
  if (this.options.ecmaVersion >= 13 && this.type === tt.string) {
    const stringLiteral = this.parseLiteral(this.value)
    if (loneSurrogate.test(stringLiteral.value)) {
      this.raise(stringLiteral.start, "An export name cannot include a lone surrogate.")
    }
    return stringLiteral
  }
  return this.parseIdent(true)
}

// Set `ExpressionStatement#directive` property for directive prologues.
pp.adaptDirectivePrologue = function(statements) {
  for (let i = 0; i < statements.length && this.isDirectiveCandidate(statements[i]); ++i) {
    statements[i].directive = statements[i].expression.raw.slice(1, -1)
  }
}

/** */
pp.isDirectiveCandidate = function(statement) {
  return (
    this.options.ecmaVersion >= 5 &&
    statement.type === "ExpressionStatement" &&
    statement.expression.type === "Literal" &&
    typeof statement.expression.value === "string" &&
    // Reject parenthesized strings.
    (this.input[statement.start] === "\"" || this.input[statement.start] === "'")
  )
}
