import {Parser} from "./state.js"
import {Position, SourceLocation} from "./locutil.js"
import { TokenType } from "./tokentype.js";

export class Node {
  /**
   * 用于指示break和continue的时候跳出到哪个循环.
   * @type {Node | null}
   */
  // label
  /** @type {Node | undefined} 条件语句设置, 比如for循环的中间语句 */
  // test
  /** @type {Node} */
  // body
  /** @type {Node | undefined} */
  // init = undefined; // for 循环中的初始化语句
  /** @type {Node} for循环中的update语句 */
  // update = undefined;
  // declarations Node[] 在VariableDeclaration时设置, 定义当前var设置的变量列表
  // expression
  // expressions 表达式列表, 如let a,b,c = xxx中的abc
  // argument 在await中会设置, 存放await后的调用
  // {Node} property 设置成员表达式, 包括[1], ['a'], .aaa 3种类型
  // {Node }object 设置父对象, 比如 aaa.bbb时, bbb的node.object设置为aaa的node
  // {boolean} computed 设置是否动态获取, 比如[1], ['a']
  // {boolean} optional 是否可选链
  // {Node} callee, 比如fn() 中的fn
  // {Node[]} arguments, 比如fn(a,b,c)中的a,b,c
  // {Node} tag, 用于tag template
  // {Node} quasi, 用于设置template
  // {string} operator, 设置操作符, 如+=, -=, =

  /**
   * 
   * @param {Parser} parser 
   * @param {number} pos 
   * @param {Position} loc 
   */
  constructor(parser, pos, loc) {
    this.type = ""
    /** @type {number} */
    this.start = pos
    /** @type {number} */
    this.end = 0
    if (parser.options.locations)
      /** @type {SourceLocation} */
      this.loc = new SourceLocation(parser, loc)
    if (parser.options.directSourceFile)
      /** @type {string} */
      this.sourceFile = parser.options.directSourceFile
    if (parser.options.ranges)
      /** @type {number[]} */
      this.range = [pos, 0]
  }
}

// Start an AST node, attaching a start offset.

const pp = Parser.prototype

/**
 * 
 * @returns {Node}
 * @type {() => Node}
 */
pp.startNode = function() {
  return new Node(this, this.start, this.startLoc)
}

/**
 * 
 * @param {number} pos 
 * @param {Position} loc 
 * @returns {Node}
 */
pp.startNodeAt = function(pos, loc) {
  return new Node(this, pos, loc)
}

// Finish an AST node, adding `type` and `end` properties.
/**
 * 
 * @param {Node} node 
 * @param {string} type 
 * @param {number} pos 
 * @param {Position} loc 
 * @returns 
 */
function finishNodeAt(node, type, pos, loc) {
  node.type = type
  node.end = pos
  if (this.options.locations)
    node.loc.end = loc
  if (this.options.ranges)
    node.range[1] = pos
  return node
}

/**
 * 
 * @param {Node} node 
 * @param {string} type 
 * @returns 
 */
pp.finishNode = function (node, type) {
  return finishNodeAt.call(this, node, type, this.lastTokEnd, this.lastTokEndLoc)
}

// Finish node at given position

pp.finishNodeAt = function(node, type, pos, loc) {
  return finishNodeAt.call(this, node, type, pos, loc)
}

pp.copyNode = function(node) {
  let newNode = new Node(this, node.start, this.startLoc)
  for (let prop in node) newNode[prop] = node[prop]
  return newNode
}
