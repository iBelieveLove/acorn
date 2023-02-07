// ## Token types

// The assignment of fine-grained, information-carrying type objects
// allows the tokenizer to store the information it has about a
// token in a way that is very cheap for the parser to look up.

// All token type variables start with an underscore, to make them
// easy to recognize.

// The `beforeExpr` property is used to disambiguate between regular
// expressions and divisions. It is set on all token types that can
// be followed by an expression (thus, a slash after them would be a
// regular expression).
//
// The `startsExpr` property is used to check if the token ends a
// `yield` expression. It is set on all token types that either can
// directly start an expression (like a quotation mark) or can
// continue an expression (like the body of a string).
//
// `isLoop` marks a keyword as starting a loop, which is important
// to know when parsing a label, in order to allow or disallow
// continue jumps to that label.

/**
 * tokenType的类型定义
 */
export class TokenType {
  /**
   * @param {string} label 
   * @param {{keyword: string; }} conf
   */
  constructor(label, conf = {}) {
    /** @type {string} */
    this.label = label // string
    /** @type {string} */
    this.keyword = conf.keyword // string, 如'if', 'this'
    this.beforeExpr = !!conf.beforeExpr
    this.startsExpr = !!conf.startsExpr
    this.isLoop = !!conf.isLoop
    this.isAssign = !!conf.isAssign
    this.prefix = !!conf.prefix
    this.postfix = !!conf.postfix
    /** @type {number | null} */
    this.binop = conf.binop || null // boolean | null
    /** @type {() => void | null} */
    this.updateContext = null
  }
}

function binop(name, prec) {
  return new TokenType(name, {beforeExpr: true, binop: prec})
}
const beforeExpr = {beforeExpr: true}, startsExpr = {startsExpr: true}

// Map keyword names to token types.

export const keywords = {}

// Succinct definitions of keyword token types
function kw(name, options = {}) {
  options.keyword = name
  return keywords[name] = new TokenType(name, options)
}

/**
 * @description 预定义对应关键词的token类型, 包括基础数据类型.
 */
export const types = {
  num: new TokenType("num", startsExpr),
  regexp: new TokenType("regexp", startsExpr),
  string: new TokenType("string", startsExpr),
  // 正常的变量, 以及部分的关键词也会使用name
  name: new TokenType("name", startsExpr),
  // #开头表示的变量
  privateId: new TokenType("privateId", startsExpr),
  eof: new TokenType("eof"), // 标识结束符

  // Punctuation token types.
  bracketL: new TokenType("[", {beforeExpr: true, startsExpr: true}),
  bracketR: new TokenType("]"),
  braceL: new TokenType("{", {beforeExpr: true, startsExpr: true}),
  braceR: new TokenType("}"),
  parenL: new TokenType("(", {beforeExpr: true, startsExpr: true}),
  parenR: new TokenType(")"),
  comma: new TokenType(",", beforeExpr),
  semi: new TokenType(";", beforeExpr),
  colon: new TokenType(":", beforeExpr),
  dot: new TokenType("."), // 点
  question: new TokenType("?", beforeExpr),
  questionDot: new TokenType("?."),
  arrow: new TokenType("=>", beforeExpr),
  template: new TokenType("template"),
  invalidTemplate: new TokenType("invalidTemplate"),
  ellipsis: new TokenType("...", beforeExpr), // 三点解构符
  backQuote: new TokenType("`", startsExpr), //
  dollarBraceL: new TokenType("${", {beforeExpr: true, startsExpr: true}),

  // Operators. These carry several kinds of properties to help the
  // parser use them properly (the presence of these properties is
  // what categorizes them as operators).
  //
  // `binop`, when present, specifies that this operator is a binary
  // operator, and will refer to its precedence.
  //
  // `prefix` and `postfix` mark the operator as a prefix or postfix
  // unary operator.
  //
  // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
  // binary operators with a very low precedence, that should result
  // in AssignmentExpression nodes.

  eq: new TokenType("=", {beforeExpr: true, isAssign: true}),
  assign: new TokenType("_=", {beforeExpr: true, isAssign: true}),
  incDec: new TokenType("++/--", {prefix: true, postfix: true, startsExpr: true}),
  prefix: new TokenType("!/~", {beforeExpr: true, prefix: true, startsExpr: true}),
  logicalOR: binop("||", 1),
  logicalAND: binop("&&", 2),
  bitwiseOR: binop("|", 3),
  bitwiseXOR: binop("^", 4),
  bitwiseAND: binop("&", 5),
  equality: binop("==/!=/===/!==", 6),
  relational: binop("</>/<=/>=", 7),
  bitShift: binop("<</>>/>>>", 8),
  plusMin: new TokenType("+/-", {beforeExpr: true, binop: 9, prefix: true, startsExpr: true}),
  modulo: binop("%", 10),
  star: binop("*", 10),
  slash: binop("/", 10),
  starstar: new TokenType("**", {beforeExpr: true}),
  coalesce: binop("??", 1),

  // Keyword token types.
  _break: kw("break"),
  _case: kw("case", beforeExpr),
  _catch: kw("catch"),
  _continue: kw("continue"),
  _debugger: kw("debugger"),
  _default: kw("default", beforeExpr),
  _do: kw("do", {isLoop: true, beforeExpr: true}),
  _else: kw("else", beforeExpr),
  _finally: kw("finally"),
  _for: kw("for", {isLoop: true}),
  _function: kw("function", startsExpr),
  _if: kw("if"),
  _return: kw("return", beforeExpr),
  _switch: kw("switch"),
  _throw: kw("throw", beforeExpr),
  _try: kw("try"),
  _var: kw("var"),
  _const: kw("const"),
  _while: kw("while", {isLoop: true}),
  _with: kw("with"),
  _new: kw("new", {beforeExpr: true, startsExpr: true}),
  _this: kw("this", startsExpr),
  _super: kw("super", startsExpr),
  _class: kw("class", startsExpr),
  _extends: kw("extends", beforeExpr),
  _export: kw("export"),
  _import: kw("import", startsExpr),
  _null: kw("null", startsExpr),
  _true: kw("true", startsExpr),
  _false: kw("false", startsExpr),
  _in: kw("in", {beforeExpr: true, binop: 7}),
  _instanceof: kw("instanceof", {beforeExpr: true, binop: 7}),
  _typeof: kw("typeof", {beforeExpr: true, prefix: true, startsExpr: true}),
  _void: kw("void", {beforeExpr: true, prefix: true, startsExpr: true}),
  _delete: kw("delete", {beforeExpr: true, prefix: true, startsExpr: true})
}

export const NodeTypes = {
  Program: 'Program',
  EmptyStatement: 'EmptyStatement',
  Identifier: 'Identifier',
  VariableDeclaration: 'VariableDeclaration',
  BreakStatement: 'BreakStatement',
  ContinueStatement: 'ContinueStatement',
  DebuggerStatement: 'DebuggerStatement',
  DoWhileStatement: 'DoWhileStatement',
  IfStatement: 'IfStatement',
  ReturnStatement: 'ReturnStatement',
  SwitchCase: 'SwitchCase',
  SwitchStatement: 'SwitchStatement',
  ThrowStatement: 'ThrowStatement',
  CatchClause: 'CatchClause',
  TryStatement: 'TryStatement',
  WhileStatement: 'WhileStatement',
  WithStatement: 'WithStatement',
  LabeledStatement: 'LabeledStatement',
  ExpressionStatement: 'ExpressionStatement',
  BlockStatement: 'BlockStatement',
  ForStatement: 'ForStatement',
  ForInStatement: 'ForInStatement',
  ForOfStatement: 'ForOfStatement',
  VariableDeclarator: 'VariableDeclarator',
  FunctionDeclaration: 'FunctionDeclaration',
  FunctionExpression: 'FunctionExpression',
  ClassBody: 'ClassBody',
  ClassDeclaration: 'ClassDeclaration',
  ClassExpression: 'ClassExpression',
  MethodDefinition: 'MethodDefinition',
  PropertyDefinition: 'PropertyDefinition',
  StaticBlock: 'StaticBlock',
  ExportAllDeclaration: 'ExportAllDeclaration',
  ExportDefaultDeclaration: 'ExportDefaultDeclaration',
  ExportNamedDeclaration: 'ExportNamedDeclaration',
  ExportSpecifier: 'ExportSpecifier',
  ImportDeclaration: 'ImportDeclaration',
  ImportDefaultSpecifier: 'ImportDefaultSpecifier',
  ImportNamespaceSpecifier: 'ImportNamespaceSpecifier',
  ImportSpecifier: 'ImportSpecifier',
  SpreadElement: 'SpreadElement', // ...解构, 如let a = [...c]
  RestElement: 'RestElement', // ...解构赋值, 如 let [...aaa] = bbb;
  ArrayPattern: 'ArrayPattern', // 解析出的单个语句, 如let [a,b]
  AssignmentPattern: 'AssignmentPattern', // 类似let [a, b = 2] = c 中的b=2
  ChainExpression: 'ChainExpression', // 可选链表达式
  ArrowFunctionExpression: 'ArrowFunctionExpression', // 箭头函数
  MemberExpression: 'MemberExpression', // 成员表达式
  CallExpression: 'CallExpression', // 调用表达式, 如fn()
  TaggedTemplateExpression: 'TaggedTemplateExpression',
  AssignmentExpression: 'AssignmentExpression', // +=, -= 等
  ConditionalExpression: 'ConditionalExpression', // ? : 三元表达式
  AwaitExpression: 'AwaitExpression', // await 类型表达式
  YieldExpression: 'YieldExpression', // yield表达式
  ObjectPattern: 'ObjectPattern', // object变量定义式, 如let {a, b = 2} = { a: 3, b: 4} 
  ObjectExpression: 'ObjectExpression', // object定义, 如 obj = { c: 3, d: 4}
  UpdateExpression: 'UpdateExpression', // ++/-- 这种自增自减表达式, 在前面时
  UnaryExpression: 'UnaryExpression', // ++/-- 这种自增自减表达式, 在后面时, 或者typeof, delete这种表达式, 或者+/-这种表达正负
  Literal: 'Literal', // null, true, false, 数字, 字符串等
  ArrayExpression: 'ArrayExpression',
  SequenceExpression: 'SequenceExpression', // (a,b,c)
  MetaProperty: 'MetaProperty',
  NewExpression: 'NewExpression',
}