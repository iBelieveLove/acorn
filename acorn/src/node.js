import {Parser} from "./state.js"
import {Position, SourceLocation} from "./locutil.js"

export class Node {
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

function finishNodeAt(node, type, pos, loc) {
  node.type = type
  node.end = pos
  if (this.options.locations)
    node.loc.end = loc
  if (this.options.ranges)
    node.range[1] = pos
  return node
}

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
