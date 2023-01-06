# Parser
https://blog.klipse.tech/javascript/2017/02/08/tiny-compiler-parser.html

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