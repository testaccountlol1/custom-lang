#!/usr/bin/env node
import fs from "fs";
import readline from "readline";

// ---------- INPUT ----------
function input(prompt = "") {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

// ---------- TOKENIZER ----------
function tokenize(code) {
  let tokens = [];
  let i = 0;

  while (i < code.length) {
    let c = code[i];

    if (/\s/.test(c)) { i++; continue; }

    // numbers
    if (/[0-9]/.test(c)) {
      let num = "";
      while (/[0-9]/.test(code[i])) num += code[i++];
      tokens.push({ type: "number", value: Number(num) });
      continue;
    }

    // identifiers
    if (/[a-zA-Z_]/.test(c)) {
      let id = "";
      while (/[a-zA-Z0-9_]/.test(code[i])) id += code[i++];
	    tokens.push({ type: "id", value: id });
      	    continue;
    }

    // strings
    if (c === '"') {
      i++;
      let str = "";
      while (code[i] !== '"') str += code[i++];
      i++;
      tokens.push({ type: "string", value: str });
      continue;
    }

    // multi-char operators
    let two = code.slice(i, i+2);
    if (["==","!=","<=",">="].includes(two)) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }

    // single char
    tokens.push({ type: "op", value: c });
    i++;
  }

  return tokens;
}

// ---------- PARSER ----------
function parser(tokens) {
  let i = 0;

  function peek() { return tokens[i]; }
  function next() { return tokens[i++]; }

  function parsePrimary() {
    let t = next();
    if (!t) return null;

    if (t.type === "number" || t.type === "string") return t.value;

    if (t.type === "id") {
      if (peek()?.value === "(") {
        next();
        let args = [];
        while (peek()?.value !== ")") {
          args.push(parseExpression());
          if (peek()?.value === ",") next();
        }
        next();
        return { type: "call", name: t.value, args };
      }
      return { type: "var", name: t.value };
    }
  }

  function parseExpression() {
    let left = parsePrimary();

    while (peek() && ["+","-","*","/","%","<",">","<=",">=","==","!="].includes(peek().value)) {
      let op = next().value;
      let right = parsePrimary();
      left = { type: "binop", op, left, right };
    }

    return left;
  }

  function parseStatement() {
    let t = peek();
    if (!t) return null;

    // variable
    if (t.value === "int" || t.value === "str") {
      next();
      let name = next().value;
      next(); // =
      let value = parseExpression();
      next(); // ;
      return { type: "var", name, value };
    }

    // assignment
    if (t.type === "id" && tokens[i+1]?.value === "=") {
      let name = next().value;
      next();
      let value = parseExpression();
      next();
      return { type: "assign", name, value };
    }

    // say
    if (t.value === "say") {
      next(); next();
      let value = parseExpression();
      next(); next();
      return { type: "say", value };
    }

    // while
    if (t.value === "while") {
      next(); next();
      let cond = parseExpression();
      next(); next();

      let body = [];
      while (peek()?.value !== "}") body.push(parseStatement());
      next();

      return { type: "while", cond, body };
    }

    // if / else
    if (t.value === "if") {
      next(); next();
      let cond = parseExpression();
      next(); next();

      let body = [];
      while (peek()?.value !== "}") body.push(parseStatement());
      next();

      let elseBody = null;
      if (peek()?.value === "else") {
        next(); next();
        elseBody = [];
        while (peek()?.value !== "}") elseBody.push(parseStatement());
        next();
      }

      return { type: "if", cond, body, elseBody };
    }

    // for
    if (t.value === "for") {
      next(); next();

      let init = parseStatement();
      let cond = parseExpression();
      next();
      let increment = parseExpression();
      next(); next();

      let body = [];
      while (peek()?.value !== "}") body.push(parseStatement());
      next();

      return { type: "for", init, cond, increment, body };
    }

    // fallback (CRITICAL FIX)
    next();
    return null;
  }

  let ast = [];

  while (i < tokens.length) {
    let before = i;
    let stmt = parseStatement();

    if (stmt) ast.push(stmt);

    if (i === before) {
      console.error("Parser stuck at:", tokens[i]);
      i++;
    }
  }

  return ast;
}

// ---------- INTERPRETER ----------
async function runAST(ast) {
  let vars = {};

  async function evalExpr(expr) {
    if (typeof expr === "number" || typeof expr === "string") return expr;

    if (expr.type === "var") return vars[expr.name];

    if (expr.type === "call") {
      if (expr.name === "input") {
        let arg = await evalExpr(expr.args[0]);
        return await input(arg);
      }
    }

    if (expr.type === "binop") {
      let l = await evalExpr(expr.left);
      let r = await evalExpr(expr.right);

      switch (expr.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return l / r;
        case "%": return l % r;
        case "<": return l < r;
        case ">": return l > r;
        case "<=": return l <= r;
        case ">=": return l >= r;
        case "==": return l == r;
        case "!=": return l != r;
      }
    }
  }

  async function exec(stmt) {
    if (!stmt) return;

    if (stmt.type === "var" || stmt.type === "assign") {
      vars[stmt.name] = await evalExpr(stmt.value);
    }

    if (stmt.type === "say") {
      console.log(await evalExpr(stmt.value));
    }

    if (stmt.type === "while") {
      while (await evalExpr(stmt.cond)) {
        for (let s of stmt.body) await exec(s);
      }
    }

    if (stmt.type === "if") {
      if (await evalExpr(stmt.cond)) {
        for (let s of stmt.body) await exec(s);
      } else if (stmt.elseBody) {
        for (let s of stmt.elseBody) await exec(s);
      }
    }

    if (stmt.type === "for") {
      await exec(stmt.init);
      while (await evalExpr(stmt.cond)) {
        for (let s of stmt.body) await exec(s);
        await evalExpr(stmt.increment);
      }
    }
  }

  for (let stmt of ast) await exec(stmt);
}

// ---------- MAIN ----------
if (process.argv.length < 3) {
  console.error("Usage: is <file>");
  process.exit(1);
}

const code = fs.readFileSync(process.argv[2], "utf-8");
const tokens = tokenize(code);
const ast = parser(tokens);
runAST(ast);
