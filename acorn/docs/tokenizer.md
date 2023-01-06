# Tokenizer分词器
https://blog.klipse.tech/javascript/2017/02/08/tiny-compiler-tokenizer.html
## Tokenizer分词原理
1. 通常来说, 分词器是根据空格, 分号, 括号, 等号, 点号, 逗号, 冒号等等进行分词操作.
2. 在进行分词后, 根据当前分词的结果, 包装成一个Token队列.
比如说: 对于`class Test {}`, 会根据class关键词进行分词, 作为一组结果.

## acorn
### token结构
```
interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
  loc: SourceLocation; // 在options.locations启用时存在
  range: number[]; // 在options.ranges启用时存在
}
```

### 调用
1. 循环调用`getToken()` 获取下一个Token内容, 直到获得的TokenType 等于`TokTypes.eof`
2. 在`getToken()`中, 调用`next()`读取下一个Token, 并返回`new Token(this)`
3. 在`next()`中, 记录当前的token位置, 然后调用`nextToken()`
4. 在`nextToken()`中, 会先获取`curContext()`得到当前上下文, 并尝试跳过空格和注释, 记录当前pos为start, 记录startLoc
   1. 如果超出内容, 则返回eof
   2. 如果有override, 则调用override执行, 这里通常是\`所在的位置, 读取template并覆盖写入context
   3. 最后调用readToken读取token.
5. 在`readToken()`中, 根据code值, 判断是否合法的变量名开头, 如果是, 则执行`readWord()`, 否则执行`getTokenFromCode()`
6. 在`readWord()`中, 会调用`readWord1()`读出一个字符串, 然后使用keywords正则表达式测试, 如果是keyword, 则作为keyword返回, 否则作为变量名返回
7. 在`readWord1()`中, 会正常读出一个合法的变量名, 并返回字符串.
8. `getTokenFromCode()`根据不同的入参, 区别读出不一样的Token类型.