const { test } = require("node:test");
const assert = require("node:assert/strict");
const { requireAuth } = require("./auth");

function run(auth, username, password) {
  const oldUser = process.env.APP_USERNAME;
  const oldPass = process.env.APP_PASSWORD;
  if (username === undefined) delete process.env.APP_USERNAME; else process.env.APP_USERNAME = username;
  if (password === undefined) delete process.env.APP_PASSWORD; else process.env.APP_PASSWORD = password;
  const res = {
    statusCode: 200, headers: {}, body: "",
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    send(text) { this.body = text; return this; }
  };
  let allowed = false;
  try { requireAuth({ headers: auth ? { authorization: auth } : {} }, res, () => { allowed = true; }); }
  finally {
    if (oldUser === undefined) delete process.env.APP_USERNAME; else process.env.APP_USERNAME = oldUser;
    if (oldPass === undefined) delete process.env.APP_PASSWORD; else process.env.APP_PASSWORD = oldPass;
  }
  return { res, allowed };
}
const basic = (u, p) => "Basic " + Buffer.from(u + ":" + p).toString("base64");

test("unconfigured application fails closed", () => {
  const result = run(undefined);
  assert.equal(result.res.statusCode, 503);
  assert.equal(result.allowed, false);
});

test("missing or invalid credentials fail with browser challenge", () => {
  for (const auth of [undefined, basic("u", "bad"), "Bearer anything", "Basic !!!!"]) {
    const result = run(auth, "u", "secret");
    assert.equal(result.res.statusCode, 401);
    assert.equal(result.allowed, false);
    assert.match(result.res.headers["WWW-Authenticate"], /Basic/);
  }
});

test("correct credentials are accepted and responses disable caching", () => {
  const result = run(basic("u", "secret"), "u", "secret");
  assert.equal(result.allowed, true);
  assert.equal(result.res.headers["Cache-Control"], "no-store");
});
