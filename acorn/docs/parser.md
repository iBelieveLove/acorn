# Parser
https://blog.klipse.tech/javascript/2017/02/08/tiny-compiler-parser.html

# 简单教程.
## Code organization
Our code is going to be organized this way:

1. parseProgram: receives an array of tokens and return a Program node with a body - calling parseToken
2. parseToken: receives a single token and according to its type calls either 
3. parseNumber, parseString or parseExpression
4. parseNumber: receives a token and returns a Number node
5. parseString receives a token and returns a String node
6. parseExpression: receives a token and returns an Expression node - calling parseToken recursively

Each parser (except parseProgram) returns an array with:
1. the updated current position
2. the parsed node

## Expression parsing
The code of parseExpression is going to:

1. Skip the first token - it is the opening parenthesis
2. Create a base node with the type CallExpression, and name from the current token
3. Recursivelly call parseToken until we encounter a closing parenthesis
4. Skip the last token - it is the closing parenthesis
```
parseExpression =  (tokens, current)  => {
  let token = tokens[++current];
  let node = {
    type: 'CallExpression',
    name: token.value,
    params: [],
  };							
  token = tokens[++current];								  
  while (!(token.type === 'paren' && token.value ===')')) {
    [current, param] = parseToken(tokens, current);
    node.params.push(param);
    token = tokens[current];
  }									
  current++;
  return [current, node];
}
```

## Token parsing
The code of parseToken is really simple, calls the parser that corresponds to the token type:
```
parseToken = (tokens, current) => {
  let token = tokens[current];
  if (token.type === 'number') {
    return parseNumber(tokens, current);
  }
  if (token.type === 'string') {
    return parseString(tokens, current);
  }
  if (token.type === 'paren' && token.value === '(') {
    return parseExpression(tokens, current);
  }
  throw new TypeError(token.type);
}
```

## Program parsing
A program is composed by a series of expressions, therefore parseProgram is going to call parseToken until all the tokens are parsed:
```
function parseProgram(tokens) {
  let current = 0;
  let ast = {
    type: 'Program',
    body: [],
  };
  let node = null;
  while (current < tokens.length) {
    [current, node] = parseToken(tokens, current);
    ast.body.push(node);
  }
  return ast;
}
```

# 源码


## 导读
1. `parse()` 在执行完`new Parser()`后, 调用`startNode()`开始一个node解析, 然后执行`nextToken()`读取token, 进入`parseTopLevel()`
2. `parseTopLevel()` 是parse的入口函数, 负责构建一个program类型的Node作为ast树的根.
   1. 循环执行`parseStatement()`, 直到`next()`到达eof, 作为body
   2. 判断是否有未定义export, 如果有则报错
   3. 执行`adaptDirectivePrologue()`, 调整`ExpressionStatement`的指令(todo)
3. <span id="parseStatement">`parseStatement()`</span>的功能是解析单个statement, 包括定义函数, 定义变量, 赋值变量等
   1. 先判断是否`let`表达式, 如果是则将tokenType转化为`_var`
   2. 根据tokenType选择解析函数
      1. `_break`和`_continue`, 执行[`parseBreakContinueStatement()`](#parseBreakContinueStatement)
      2. `_debuger`, 执行[`parseDebuggerStatement()`](#parseDebuggerStatement)
      3. `_do`, 执行[`parseDoStatement()`](#parseDoStatement)
      4. `_for`, 执行[`parseForStatement()`](#parseForStatement)
      5. `_function`, 执行[`parseFunctionStatement()`](#parseFunctionStatement)
      6. `_class`, 执行[`parseClass()`](#parseClass)
      7. `_if`, 执行[`parseIfStatement()`](#parseIfStatement)
      8. `_return`, 执行[`parseReturnStatement()`](#parseReturnStatement)
      9. `_switch`, 执行[`parseSwitchStatement()`](#parseSwitchStatement)
      10. `_throw`, 执行[`parseThrowStatement()`](#parseThrowStatement)
      11. `_try`, 执行[`parseTryStatement()`](#parseTryStatement)
      12. `_const`,`_var`, 执行[`parseVarStatement()`](#parseVarStatement)
      13. `_while`, 执行[`parseWhileStatement()`](#parseWhileStatement)
      14. `_with`, 执行[`parseWithStatement()`](#parseWithStatement)
      15. `braceL`, 执行[`parseBlock()`](#parseBlock)
      16. `semi`, 执行[`parseEmptyStatement()`](#parseEmptyStatement)
      17. `_export`, 调用`parseExport`并返回
      18. `_import`, 先判断下一个字符, 如果下一个字符是`(`或`.`, 则调用`parseExpressionStatement`返回, 如果否, 则调用`parseImport`解析返回
      19. 默认情况下, 判断是否async function, 如果是则执行`parseFunctionStatement()`并返回
      20. 不是async function时, 调用`parseExpression()`解析表达式, 设为expr变量, 然后判断是否`Identifier`并且下一个为冒号, 是则调用`parseLabeledStatement()`解析返回, 否则调用`parseExpressionStatement()`解析返回


4. `parseEmptyStatement()` 解析空内容
   1. 直接返回EmptyStatement
5. <span id="parseBreakContinueStatement">`parseBreakContinueStatement()`</span>, 在判断token为break或者continue的时候调用
   1. 判断isBreak
   2. 判断后面是否接了`label`, 如果有, 则调用`parseIdent`解析得到label并设置, 否则label设为null.
   3. 在lables依次遍历, 判断`continue`和`break`是否存在合法的待跳出的循环, 如果找到了, 则跳出循环, 否则报错. 
   4. 最后是finishNode. 以BreakStatement或ContinueStatement
6. <span id="parseDebuggerStatement">`parseDebuggerStatement()`</span>, 在判断token为debuger的时候调用
   1. 尝试插入一个分号, 完成
7. <span id="parseDoStatement">`parseDoStatement()`</span>, 在判断token为do的时候调用
   1. `lables`栈插入一个kind为`loop`的label, 用于break和continue
   2. 调用[`parseStatement('do')`](#parseStatement)得到循环体内部的内容, 作为body
   3. `lables`栈弹出label
   4. 读出`while` token
   5. 调用[`parseParenExpression()`](#parseParenExpression)读出while的条件, 作为test变量
   6. 完成node
8. <span id="parseForStatement">`parseForStatement()`</span>, 读到for时调用
   1. `lables`栈插入一个loopLabel
   2. 调用enterScope, 进入新的作用域
   3. 读出左括号
   4. 判断下一个是否分号, 如果是, 则返回[`parseFor()`](#parseFor), 否则进入5
   5. 判断当前是否let, 如果是let, 或者是var或const, 则此时开始`parseVar`, 然后调用`finishNode`得到`VariableDeclaration`类型node, 判断下一个值是否`in`或者`of`, 如果是, 则返回`parseForIn()`, 否则返回`parseFor`
   6. 调用`parseExpression()`解析表达式, 判断下一个值是否`in`或者`of`, 如果是, 则先后判断`toAssignable`, 和`checkLValPattern`, 返回`parseForIn()`
   7. 最后返回`parseFor`
9. <span id="parseFunctionStatement">`parseFunctionStatement()`</span> 解析函数
    1.  调用`parseFunction`得到返回值
10. `parseIfStatement` 解析if语句表达式和内部运算块
    1.  首先调用`parseParenExpression`解析条件式并设置到node.test上
    2.  接着调用`parseStatement('if')`解析内部运算块并设置到`node.consequent`上
    3.  往下读一个token, 如果读到`else`, 则此时调用`parseStatement('if')`设置到`node.alternate`上
    4.  finishNode, 返回`IfStatement`
11. `parseReturnStatement` 解析return, 判断下一个token读到的是否分号, 如果不是则解析返回内容设置到argument上
    1.  如果下一个Token读到了分号或者换行符, 则`node.argument`设为null
    2.  否则调用`parseExpression()`解析出返回内容, 设置到`node.argument`上
    3.  返回ReturnStatement
12. `parseSwitchStatement` 解析switch
    1.  首先调用`parseParenExpression`解析出表达式, 设置到`node.discriminant`
    2.  将node.cases设为列表, 往下读到`{`
    3.  往`labels`栈插入switchLabel, 然后enterScope作用域
    4.  循环判断, 直到读到`}`后跳出循环
        1.  首先获取当前token是否`case`
        2.  如果cur已存在, 则完成`SwitchCase`
        3.  新建cur为Node, 往node.cases中插入cur, 把cur.consequent设为列表
        4.  如果是case, 则调用`parseExpression`解读出条件式, 设置到node.test上
        5.  如果不是case, 则将test设为null, 如果判断有重复的default, 则报错.
        6.  往下读出一个冒号
        7.  调用`parseStatement`解读出执行语句, 并且插入到`cur.consequent`
    5.  调用exitScope跳出作用域, 完成最后的一个`SwitchCase`
    6.  弹出labels, 然后返回SwitchStatement
13. `parseThrowStatement` 解析throw语句
    1. 判断throw后面是否有不合法的换行
    2. 调用`parseExpression`解析并设置为node.argument
    3. 返回`ThrowStatement`
14. `parseTryStatement` 解析try catch
    1.  调用`parseBlock`解析并设置为`node.block`
    2.  将`node.handler`设为null
    3.  如果读到catch, 新建一个`clause`node
        1. 如果往下读到`(`, 则调用`parseBindingAtom`解析catch表达式, 设置为`node.param`, 进入作用域, 然后读出`)`
        2. 否则将`node.param`设为null, 进入作用域(js在新版本上允许catch不含变量)
        3. 调用`parseBlock` 解析作用块, 设置为`node.body`, 退出作用域
    4. 将当前解析到的`clause`设置为`node.handler`
    5. 如果下一步读到finally, 则此时调用`parseBlock`解析设置到`node.finallizer`上.
    6. 如果`finallizer`和`handler`都没读到, 则报错(只有try没有catch和finally的情况)
    7. 返回`TryStatement`
15. `parseVarStatement` 解析变量定义
    1.  调用`parseVar`解析等号左右
    2.  返回`VariableDeclaration`
16. `parseWhileStatement` 解析while循环
    1.  首先执行`parseParenExpression`解析设置到node.test上
    2.  往`labels`栈插入loopLabel
    3.  执行`parseStatement('while')`解析代码块并且设置到node.body上
    4.  `labels`出栈
    5.  返回`WhileStatement`
17. `parseWithStatement` 解析with语句
    1.  调用`parseParenExpression`解析表达式并设置到node.object上
    2.  调用`parseStatement("with")`解析代码块, 并设置到node.body上
    3.  返回`WithStatement`
18. `parseLabeledStatement` 在parseStatement中调用
    1. 循环遍历`labels`, 如果判断存在label与当前name一致, 则报错
    2. 判断kind, 分别为loop或者switch或者null
    3. 循环执行, 更新labels中的statementStart和kind
    4. 插入当前label到`labels`上
    5. 调用`parseStatement`解析并设置为node.body上
    6. lables弹出当前label
    7. `node.label`设置为前面解析到的表达式
    8. 返回`LabeledStatement`
19. `parseExpressionStatement` 解析表达式, 如`a=1`
    1.  将`node.expression`设置为expr
    2.  返回`ExpressionStatement`
20. `parseBlock`解析代码块, 即`{}`包起来的一组代码
    1.  首先设置node.body为列表, 读出`{`
    2.  默认进入新作用域, 除非是`catch`或`function`后的代码块
    3.  循环解析, 直到读到`}`
        1.  调用`parseStatement`解析出单行语句, 然后插入到`node.body`上
    4.  如果前面进入了新作用域, 则退出作用域
    5.  返回`BlockStatement`
21. <span id="parseFor">`parseFor()`</span>, 读出正常的for循环
    1.  将初始化语句设置到`node.init`上, 读出分号
    2.  调用`parseExpression()`读出中间的语句, 设置到test上, 读出分号
    3.  调用`parseExpression()`读出更新语句, 设置到update上, 读出右括号
    4.  调用`parseStatement()` 读出循环体, 设置到body上
    5.  调用`exitScope`退出当前作用域, labels栈弹出最后一个
    6.  完成`ForStatement`
22. <span id="parseForIn">`parseForIn()`</span>, 读出for in 循环
    1. 判断isForIn
    2. 检查合法性, 不允许`for (let i = 1 of bbb)`这种类型
    3. 设置init到`node.left`
    4. 如果isForIn, 调用`parseExpression()`解析表达式, 否则调用`parseMaybeAssign()`解析, 设置到node.right, 读出右括号
    5. 调用`parseStatement()` 读出循环体, 设置到body上
    6. 调用`exitScope`退出当前作用域, labels栈弹出最后一个
    7. 完成`ForInStatement`或`ForOfStatement`
23.  <span id="parseVar">`parseVar()`</span>, 读出一组变量
     1.  声明`node.declarations`为列表, 和`node.kind`为类型
     2.  循环执行
         1.  开始新node`decl`, 调用`parseVarId`读出变量名, 设置到`node.id`上
         2.  判断下一个是否等于号, 如果是, 调用`parseMaybeAssign`解析得到node并设置到`node.init`上
         3.  如果不是等号, 则判断一下合法性: 如果当前是const, 并且下一个不是`in`或者`of`时报错, 即不允许`const aaa += 1`的形式(因为上面已经判断了等号的形式)
         4.  再判断合法性, 对`let {a,b}`, 并且不在`for-in/for-of`这种类型报错
         5.  如果没有等号又合法, 则将`node.init`设为null
         6.  往`node.declarations`插入当前node`decl`
         7.  如果没有读到逗号, 跳出循环
     3.  完成
24. <span id="parseFunction">`parseFunction()`</span>, 读出函数声明
    1.  调用`initFunction`初始化node, 将node.id设为null, 将`generator`和`expression`和`async`设为false
    2.  判断不是async函数, 然后, 如果当前是label或者if中并读到了`*`则报错, 否则如果读到`*`则设置`generator`为true
    3.  设置node.async是否为true
    4.  尝试调用`parseIdent`读出function的名字, 设置到`node.id`上, 然后进行一次合法性检查
    5.  进入作用域.
    6.  调用`parseFunctionParams`解析出函数入参列表设置到`node.params`
    7.  调用`parseFunctionBody`解析出函数的执行体设置到`node.body`
    8.  完成`FunctionDeclaration` 或`FunctionExpression`
25. <span id="parseClass">`parseClass()`</span> 解析class, 第二个参数标识是否可以不带classname
    1.  默认设置`this.strict`为true
    2.  调用`parseClassId`, 如果下一个tokentype为name, 则调用`parseIdent`解析classname并设置到`node.id`上, 如果是`let c = class { constructor(){} }`这种赋值语句, 则`node.id`为null.
    3.  调用`parseClassSuper`, 往下读一个token, 如果是`extends`, 则调用`parseExprSubscripts`解析并设置到`node.superClass`
    4.  调用`enterClassBody`生成一个变量的保存对象, 并设置到栈上, 把对象返回为map
    5.  新开一个node`classBody`, 并设置`node.body`为列表, 读出`{`
    6.  循环读取, 直到遇到`}`时退出
        1.  调用`parseClassElement`解析出class的成员定义.
            1.  如果读到分号, 则返回null
            2.  开始一个node
            3.  往下读一个token, 如果读到了`static`, 再往下读一个token, 如果读到了`{`, 则调用`parseClassStaticBlock`解析, 否则判断是否合法的class成员.
                1.  将`node.body`设为列表, 设置`this.labels`为列表, 进入作用域
                2.  循环判断, 直到读到`}`, 调用`parseStatement`解析单条语句并插入body中.
                3.  退出作用域, 回滚`this.labels`, 完成`StaticBlock`
            4.  设置`node.static`, 判断下一个是否`async`, 如果是, 则判断一下是否合法的成员, 如果是则设置为async
            5.  往下判断是否`generator`
            6.  如果既不是keyname也不是async和generator, 则往下判断是否存在get/set, 如果是, 则设置kind/keyName
            7.  如果存在`keyName`('async', 'get', 'set', or 'static'), 则返回一个`Identifier`, key设置为keyname, 否则调用`parseClassElementName`解析出class的成员名, 
            8.  判断是否async或者isGenerator, 或者是方法, 如果是, 则调用`parseClassMethod`解析成员函数
                1.  判断当前如果是constructor, 则不可以是async或者generagor, 判断不能是`static prototype`
                2.  调用`parseMethod`解析函数, 设置到`node.value`
                3.  返回`MethodDefinition`
            9.  如果不是, 则调用`parseClassField`解析成员变量
                1.  检查当前是否`constructor`, 或者`staic protetype`, 如果是则报错
                2.  读出等号, 如果读到则调用`parseMaybeAssign`解析出赋值式并设置到node.value上.
                3.  返回`PropertyDefinition`
        2.  如果解读到了, 则插入到`node.body`, 然后校验是否重复.
    7.  完成body, 然后调用`exitClassBody`, 弹出前面的变量保存对象, 从used中循环, 如果当前成员组不存在, 则插入到父对象上的used中. 如果没有父对象, 则报错.
    8.  完成`ClassDeclaration` 或 `ClassExpression`
26. `parseExport` 解析export
    1.  如果读到`*`, 则往下尝试读`as`, 如果读到as, 则调用`parseModuleExportName`解析出名字设置到`node.exported`, 然后预期读到`from`, 接着调用`parseExprAtom`解析出source, 完成`ExportAllDeclaration`.
    2.  如果读到`default`, 则
        1.  判断当前type是否`function`或者`async function`, 如果是, 则调用`parseFunction`解析出函数定义设置到`node.declaration`上
        2.  判断当前type是否`class`, 如果是, 则调用`parseClass`解析出class定义并设置到`node.declaration`上
        3.  最后是调用`parseMaybeAssign`解析出变量定义, 并设置到`node.declaration`上
        4.  完成`ExportDefaultDeclaration`
    3.  判断是否`export var|const|let|function|class`, 如果是则调用`parseStatement`并设置到`node.declaration`, 将`node.specifiers`设为空列表, `node.source`设为null
    4.  最后可能是`export { x, y as z } [from '...']`, 此时`node.declaration = null`, 调用`parseExportSpecifiers`解析出内容并设置到`node.specifiers`, 往下尝试读`from`
        1.  如果有, 则调用`parseExprAtom`解析设为`node.source`
        2.  否则, 遍历`node.specifiers`, 判断内部定义的变量是否已经定义, 如果没有则报错.
        3.  完成`ExportNamedDeclaration`
27. `parseImport` 解析import
    1.  首先判断下一个内容是否string, 如果是, 则是`import 'xxx'`格式, 此时调用`parseExprAtom`解析设置到`node.source`.
    2.  如果不是string, 则是`import xx, {xxx}`格式, 调用`parseImportSpecifiers`解析内容, 然后设置为`node.specifiers`, 然后预期读出`from`, 读出后调用`parseExprAtom`解析出`node.source`
    3.  完成`ImportDeclaration`

999. `statement` end


## expression 表达式

1.  <span id="parseVarId">`parseVarId()`</span>, 读出变量名
   1. 调用`parseBindingAtom()`读出变量名, 并设置到id上
   2. 检查合法性
2.  <span id="parseParenExpression">`parseParenExpression()`</span>, 读出表达式
   1. 首先expect读出左括号
   2. 调用[`parseStatement()`](#parseStatement)得到条件式内部的内容
   3. expect读出右括号
   4. 返回条件式的node
3.  <span id="parseExpression">`parseExpression()`</span>, 读出表达式
    1.  调用`parseMaybeAssign()`获得语句expr
    2.  判断下一个是否逗号, 如果是, 则新开一个node, 并设置`expressions`, 将上一个解读到的node加入, 如果不是逗号, 则返回expr
    3.  循环读逗号, 读到逗号后就调用`parseMaybeAssign()`获得语句并插入`expressions`
    4.  完成`SequenceExpression`
4.  <span id="parseMaybeAssign">`parseMaybeAssign()`</span>, 读出可能是赋值的表达式, 如a = 1, 兼容 a,b = 2这种, 从等号开始
    1. 判断是否`yield`, 如果是则调用`parseYield`返回
    2. 调用`parseMaybeConditional`解析出left的node, 这里是可能是三元运算表达式.
       1. 调用`parseMaybeUnary`解析出变量
       2. 判断当前是否`ArrowFunctionExpression`, 是则直接返回
       3. 否则调用`parseExprOp`解析, 得到左表达式.
          1. 首先判断当前token是否`||`,`&&`,`|`, `^`, `&`, `==/!=/===/!==`, `</>/<=/>=`, `<</>>/>>>`, `+/-`,`%`,`*`,`/`,`??`,`in`,`instanceof`这些表达式
          2. 如果不是, 直接返回
          3. 如果是, 则往下判断当前的表达式优先级是否大于前一个表达式优先级, 如果小于或等于则直接返回
          4. 往下判断当前是否逻辑运算符`||`或`&&`或`??`, 设为变量.
          5. 调用`parseMaybeUnary()`解析出下一个变量, 然后根据解析出的node, 递归调用`parseExprOp`得到right表达式
          6. 根据传入的left和解析得到的right, 调用`buildBinary`构建出来一个node
          7. 最后根据构建生成的node, 递归调用`parseExprOp`生成并返回
       4. 此时解析得到了expr, 往下读一个token, 判断是否问号`?`, 如果不是, 则返回expr
       5. 如果是, 则此时新建node, 将`node.test`设为expr
       6. 调用`parseMaybeAssign`解析出第一个值, 设为`node.consequent` 
       7. 往下预期读出`:`冒号, 调用`parseMaybeAssign`解析出第二个值, 设为`node.alternate`
       8. 返回`ConditionalExpression`
    3. 判断当前token是否有`isAssign`属性, 如果有
       1. 新建node, 并且设置`operator`为操作符
       2. 检查left合法性, `node.left`设置为left
       3. 调用`parseMaybeAssign`解析右侧的内容, 设为`node.right`
       4. 完成`AssignmentExpression`
    4. 否则返回left 
5.  `parseMaybeUnary`, 读出单个变量或者表达式, 如a, b.c, ccc[0], ddd()
    1.  如果当前是`await`的token, 并且允许await, 则此时调用`parseAwait`
    2.  否则如果当前类型是前置运算符, 如`++/--`或`typeof`等, 则此时设置node.operator为token.value, 并且设置prefix为true, 然后调用`parseMaybeUnary`读出需要操作的变量设置为node.argument. 并检查合法性
    3.  否则如果当前是`#`开头的私有变量, 则调用`parsePrivateIdent`解析私有变量, 此时私有变量后必须接`in`, 否则报错
    4.  其他的调用`parseExprSubscripts`解析, 然后如果存在postfix如`++/--`, 此时继续往下解析, 注意`++/--`后仍然支持表达式, 如`a ++ - 1`.
    5.  完成`UnaryExpression`
6.  `parseExprSubscripts` 读出调用
    1.  调用`parseExprAtom`读出调用开头
    2.  如果解析出来的node类型是箭头函数, 并且没有用括号包起来, 则直接返回, 箭头函数必须要用括号包起来才能直接调用
    3.  调用`parseSubscripts`解析并返回
7.  `parseSubscripts`解析
    1.  循环调用`parseSubscript`得到element, 在发现读取完成后退出
8.  `parseSubscript` 解析调用链等, 如`a[1]?.()['c']`
    1.  首先判断当前是否`?.`, 设置为optional变量
    2.  判断是否`[]`, 或者`.`或者前面有`?.`但当前不是`(`和`\``, 如果是, 此时解析成员表达式
        1.  如果是`[]`, 此时调用`parseExpression`并设置到node.property中
        2.  如果当前是#开头的变量, 则解析私有变量
        3.  否则解析为变量类型
        4.  将当前node作为`MemberExpression`完成
    3. 判断当前是否`(`, 如果是, 则
       1. 调用`parseExprList`解析出参数表达式列表
       2. 如果读到了`=>`, 则此时调用`parseArrowExpression`解析返回
       3. 否则开始新node, 并且将callee设置为base, arguments设置为参数表达式列表
    4. 判断当前是否`\``, 如果是, 则
       1. 调用`parseTemplate`进行解析, 设置到node.quasi
       2. 以`TaggedTemplateExpression`完成
9.  `parseMaybeConditional` 只有在parseMaybeAssign中调用
    1.  调用`parseExprOps`解析出第一个表达式
        1.  调用`parseMaybeUnary`先读出单个表达式, 然后判断当前是否`ArrowFunctionExpression`
10. `parseObj` 解析一个object内部的内容
    1.  循环调用`parseProperty`, 直到读到`}`.
    2.  将读到的property push到node.properties中.
    3.  然后根据`isPattern`决定返回`ObjectPattern`还是`ObjectExpression`;
11. `parseProperty` 只有在parseObj中调用, 解析object内的单个属性定义, 通常有3种形式: key, key: val, ...keys, 还有特殊形式: function定义, 如`{ fn(){}, async fn1(){}, *gen(){} }`
    1.  首先判断当前是否`...`, 如果是, 则判断`isPattern`, 如果是, 则调用`parseIdent`解析出变量名, 并且设置到node.argument上, 如果否, 则调用`parseMaybeAssign`读出表达式并设置到argument上, 并返回为`SpreadElement`
    2.  判断是否有`*`, 如果是, 判断为generator
    3.  调用`parsePropertyName`读出名字
    4.  判断当前是否`async`, 如果是, 则认为可能是async 函数, 继续调用`parsePropertyName`读出名字
    5.  调用`parsePropertyValue`解析出内容, 设置到node.value上, 然后完成
12. `parsePropertyName`解析出property的变量名, 设置到node.key中.
    1. 先判断是否读到`[`, 如果是, 则调用`parseMaybeAssign`读出内容, 设置为key值并返回. 对应的是`{ [aaa= 'bbb']: 21 }`类似这种语法.
    2. 判断`this.type`是否num或者string, 如果是, 则调用`parseExprAtom`解析表达式, 如果否, 则调用`parseIdent`解析变量名. 然后完成
13. `parsePropertyValue` 只有在`parseProperty`中调用, 解析出property的值. 这里有两种形式, 冒号后赋值语句, { fn(){} }这种特殊形式下的函数定义语句.
    1. 首先判断合法性, 如果是generator或者async, 此时不能接冒号.
    2. 如果读到冒号, 则此时设置kind为init, 判断是否isPattern, 是则调用`parseMaybeDefault`读出值, 否则调用`parseMaybeAssign`读出值, 设置到value中
    3. 其次判断当前是否读到`(`, 如果是, 则判断isPattern, 如果是则报错, 否则, 设置method为true, 然后调用`parseMethod`解析函数定义, 设置到init上, 对应的是`{ fn(){}, *genera(){}, async func(){} }`三种情况
    4. 判断当前type为`Identifier`, 并且name为get或set的时候, 将name设置到kind中, 然后调用`parsePropertyName`解析出对应的变量名, 然后调用`parseMethod`解析出运算表达式, 设置到node.value中, 再判断运算表达式的合法性.
    5. 判断当前type为`Identifier`的时候, 判断isPattern, 是则调用`parseMaybeDefault`读出变量, 否则判断当前是否=号, 如果是则调用`parseMaybeDefault`读出赋值, 最后是复制当前node作为值. 然后将shorthand设为true.
14. `parseIdent` 解析单个变量名, 作为`Identifier`返回
    1.  判断tokentype, 设置node.name, 如果是class或者function, 则此时需要pop context
    2.  检查变量名合法性, 完成`Identifier`类型
    3.  检查await合法性, 然后返回node
15. <span id="parseExprAtom">`parseExprAtom()`</span> 解析一个简单的表达式
    1.  首先判断当前类型是否`/`, 如果是, 则说明前面token判断错误了, 重新执行`readRegexp`, 读出正则表达式.
    2.  判断当前类型, 选择分支
        1.  `super`, 
            1.  判断当前是否`allowSuper`, 如果没有则报错
            2.  新建node, 然后判断下一个是否`(`, 如果是并且不在`constructor`中, 则报错
            3.  判断下一个是否`.`或者`[`或者`(`, 如果不是则报错
            4.  返回`Super`类型
        2.  `this`, 返回`ThisExpression`
        3.  `name`
            1.  调用`parseIdent`解析出id
            2.  判断id是否为`async`, 如果是, 并且下一个token为`function`, 则此时调用`parseFunction`解析函数并返回
            3.  判断下一个是否`=>`, 如果是, 此时为`arg => {}`类型,则调用`parseArrowExpression`解析并返回
            4.  如果当前是async, 并且当前type为`name`, 此时为`async arg => {}`, 此时调用`parseIdent`解析出id, 然后往下执行`parseArrowExpression`解析并返回.
            5.  最后, 如果上面都不满足, 则直接返回id.
        4.  `regexp`, 这里特指`/reg/`, 不包括`new RegExp()`这种
            1.  调用`parseLiteral`解析出node, 然后将`node.regex`设置为value.pattern等, 返回node
        5.  `num` 和`string`
            1.  调用`parseLiteral`解析出对应内容并返回
        6.  `null`, `true`, `false`
            1.  将node.value设置为对应value, 然后将node.raw设置为keyword, 最后返回为`Literal`
        7.  `(`
            1.  调用`parseParenAndDistinguishExpression`解析并返回
                1.  设置`exprList`, 循环读取, 直到遇到`)`, 解析出对应的参数, 并且插入到`exprList`
                2.  预期读出`)`, 
                3.  然后如果下一个读到`=>`, 则此时调用`parseArrowExpression`解析出箭头函数, 并返回
                4.  如果`exprList`长度大于1, 则返回为`SequenceExpression`, 否则返回第一个
        8.  `[`
            1.  调用`parseExprList`解析出列表, 然后设置到node.elements中
            2.  返回`ArrayExpression`
        9.  `{`, 调用`parseObj`解析返回
        10. `function`, 调用`parseFunction`并返回
        11. `class`, 调用`parseClass`并返回
        12. `new`, 调用`parseNew`并返回
            1.  首先调用`parseIdent`解析出meta(`new`), 接下来, 如果读到`.`, 则此时为`new.target`, 往下读取为`node.property`, 返回为`MetaProperty`
            2.  调用`parseSubscripts`解析出调用链, 设置为`node.callee`
            3.  如果下一个读到`(`, 则调用`parseExprList`解析出参数列表设为`node.arguments`, 否则设为空
            4.  返回为`NewExpression`
        13. `backQuote`, 调用`parseTemplate`并返回
        14. `import`, 调用`parseExprImport`并返回.
16. `parseTemplate` 解析template, 在parseSubscript和parseExprAtom中, 读到`时调用
    1.  返回的node中, 有quasis和expressions两组列表, 类似`a${b}c`这种, 解析结果为quasis=[a,c], expressions=[b]
17. `parseMethod` 解析object或者class 方法, 在parseObj或者parseClassMethod中调用
    1.  初始化node, 进入作用域
    2.  读出`(`, 然后调用`parseBindingList`解析出参数并设置为`node.params`
    3.  调用`parseFunctionBody`解析出函数体.
    4.  返回为`FunctionExpression`
18. `parseExprList` 解析一组表达式列表
    1.  循环执行, 直至读到close, 如果遇到了`...`则调用`parseSpread`解析, 否则调用`parseMaybeAssign`解析
19. `parseArrowExpression` 解析箭头函数
20. 



30. `parsePrivateIdent` 解析#开头的私有变量, 并插入到privateNameStack中
   1. startNode之后, 判断type为privateId, 将value设置到name上, 然后push到privateNameStack, 完成node
31. `parseAwait` 只在`parseMaybeUnary`中调用, 如`await aaa()`, 返回AwaitExpression, 并将调用的内容使用parseMaybeUnary解析出来设置为argument
   1. 调用`parseMaybeUnary`解析出后面的调用表达式, 设置到node.argument上, 并完成node, 返回`AwaitExpression`
32. `parseYield` 只在`parseMaybeAssign`中调用
   1. `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/yield`, yield和await的区别在于yield后面可以是赋值式可以是表达式, await后面只会是表达式. 如`yield index++`
   2. 调用`parseMaybeAssign`读出表达式, 并设置到argument中, 完成node返回`YieldExpression`


## lval 主要是检查合法性, 和部分解析
1. <span id="toAssignable">`toAssignable()`</span>, 检查合法性, 并修正type类型为赋值类型
2. `toAssignableList` 对列表执行`toAssignable`
3. `parseSpread` 解析解构表达式, 如`let a = [...c]`, 还允许`let [a] = [ ...c = [123]]`这种语法.
   1. 调用`parseMaybeAssign()`解析并设置到node.arguments中, 返回为`SpreadElement`(这个类型不可赋值)
4. `parseRestBinding()` 解析解构赋值表达式, 如`let [...aaa] = bbb`, 只在`parseExprList`中调用
   1. 调用`parseBindingAtom()`解析并设置到node.arguments上, 并返回为`RestElement`
5. <span id="parseBindingAtom">`parseBindingAtom()`</span>, 解析单个变量或表达式, 如`let [a,b], {c, d}, e`
    1. 判断当前type, 如果是左中括号`[`, 则调用`parseBindingList()`解析, 并插入到elements
    2. 如果是左大括号{, 则调用`parseObj()`
    3. 否则返回`parseIdent()`
6. `parseBindingList()` 在`let [a,b] = c`这种赋值语句中使用, 也可以是function (a,b){}这种语句中, 连续解析多个node, 直到遇到close, 然后返回解析到的node
   1. 设置elts列表
   2. while循环遍历读取, 如果读到close则跳出循环
      1. 判断如果不是第一个, 则预期读到逗号
      2. 如果允许空白, 同时读到逗号, 则`elts`插入null
      3. 如果读到了逗号, 则往后读一个token, 如果读到close则跳出. 如`let [a,b,] = xxx`
      4. 如果读到了`...`, 则调用`parseRestBinding()`解析出node, `elts`插入node, 判断下一个token是逗号则报错, 并且预期下一个为close, 跳出循环
      5. 调用`parseMaybeDefault()`解析出可能是赋值的表达式, 如`let [a = 1] = [2]`或`let [a] = [2]`, 插入`elts`.
      6. 返回elts
7. `parseMaybeDefault()` 解析单个变量, 同时兼容 a = 1这种有默认值的情况
   1. 如果没有传入left值, 则调用`parseBindingAtom()`解析left
   2. 如果没有读到`=`号, 返回left作为node
   3. 否则, 将left设置到node.left, 然后调用`parseMaybeAssign()`解析并设置到node.right, 将node作为`AssignmentPattern`返回.
   

## scope 定义作用域
1. `enterScope()`新建作用域对象, 并且插入 scopeStack
2. `exitScope()` 从scopeStack弹出一个对象

## parseMaybeAssign 和 parseMaybeUnary
1. `parseMaybeAssign()`解读的可能是一个赋值表达式, 这个函数也会调用`parseMaybeUnary`
2. `parseMaybeUnary()` 解读的是一个调用表达式, 或者是单个变量


## 针对不同语句的解析路径
### 变量, 定义, 赋值
1. `let a = 1`定义赋值, `let a` 定义
   1. `VariableDeclaration`, 调用`parseVarStatement`解析, 然后调用`parseVar`解析等号两边.
2. `a = 1` 赋值
   1. `ExpressionStatement`, 在`parseStatement`的default中, 调用`parseExpression`解析后, 调用`parseExpressionStatement`生成

### 声明语句
1. 