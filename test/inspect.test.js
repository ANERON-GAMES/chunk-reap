import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GRACE_MS,
  SHA256_HEX_LEN,
  buildReferenceSet,
  isChunkFilename,
  isSha256Hex
} from "../src/index.js";

function sha(text) {
  return text.repeat(SHA256_HEX_LEN / text.length);
}

test("the grace window is 24 hours and a sha256 hex string is 64 characters", () => {
  assert.equal(GRACE_MS, 24 * 60 * 60 * 1000);
  assert.equal(GRACE_MS, 86400000);
  assert.equal(SHA256_HEX_LEN, 64);
});

test("a chunk filename contains _part or starts with chunk_", () => {
  assert.equal(isChunkFilename("chunk_1"), true);
  assert.equal(isChunkFilename("chunk_"), true);
  assert.equal(isChunkFilename("chunk_extra_part"), true);
  assert.equal(isChunkFilename("upload_part3"), true);
  assert.equal(isChunkFilename("upload_partial"), true);
  assert.equal(isChunkFilename("_part"), true);
  assert.equal(isChunkFilename("aa_partbb"), true);
  assert.equal(isChunkFilename("photo.jpg"), false);
  assert.equal(isChunkFilename("partial"), false);
  assert.equal(isChunkFilename("partition"), false);
  assert.equal(isChunkFilename("chunk"), false);
  assert.equal(isChunkFilename("xchunk_1"), false);
  assert.equal(isChunkFilename("Chunk_1"), false);
  assert.equal(isChunkFilename("CHUNK_1"), false);
  assert.equal(isChunkFilename("_PART"), false);
  assert.equal(isChunkFilename("my_file.jpg"), false);
  assert.equal(isChunkFilename(""), false);
  assert.equal(isChunkFilename(" chunk_1"), false);
});

test("a non-string filename is not a chunk filename", () => {
  assert.equal(isChunkFilename(null), false);
  assert.equal(isChunkFilename(undefined), false);
  assert.equal(isChunkFilename(1), false);
  assert.equal(isChunkFilename(["chunk_1"]), false);
  assert.equal(isChunkFilename({ name: "chunk_1" }), false);
});

test("a sha256 value is 64 hex digits after trim and lowercasing", () => {
  const lower = sha("ab");
  assert.equal(lower.length, SHA256_HEX_LEN);
  assert.equal(isSha256Hex(lower), true);
  assert.equal(isSha256Hex(lower.toUpperCase()), true);
  assert.equal(isSha256Hex("  " + lower + "\n"), true);
  assert.equal(isSha256Hex("\t" + sha("a") + " "), true);
  assert.equal(isSha256Hex(sha("Ab")), true);
  assert.equal(isSha256Hex(sha("a").slice(0, SHA256_HEX_LEN - 1)), false);
  assert.equal(isSha256Hex(sha("a") + "a"), false);
  assert.equal(isSha256Hex(sha("g")), false);
  assert.equal(isSha256Hex(lower.slice(0, 32) + " " + lower.slice(32)), false);
  assert.equal(isSha256Hex(""), false);
  assert.equal(isSha256Hex("pending"), false);
});

test("a non-string sha256 value is not hex", () => {
  assert.equal(isSha256Hex(null), false);
  assert.equal(isSha256Hex(undefined), false);
  assert.equal(isSha256Hex(64), false);
  assert.equal(isSha256Hex(sha("ab").split("")), false);
});

test("the reference set unions nested attachment ids and message attachment ids", () => {
  const lists = [
    ["att-live", ""],
    [null, "att-old"]
  ];
  const messages = ["att-live", null, "att-old", "msg-only", ""];
  const ids = buildReferenceSet(lists, messages);

  assert.equal(ids instanceof Set, true);
  assert.equal(ids.size, 3);
  assert.equal(ids.has("att-live"), true);
  assert.equal(ids.has("att-old"), true);
  assert.equal(ids.has("msg-only"), true);
  assert.equal(ids.has(""), false);

  lists[0].push("later");
  messages.push("later-message");
  assert.equal(ids.has("later"), false);
  assert.equal(ids.has("later-message"), false);
});

test("null and omitted id lists are an empty reference set", () => {
  assert.equal(buildReferenceSet(null, null).size, 0);
  assert.equal(buildReferenceSet(undefined, undefined).size, 0);
  assert.equal(buildReferenceSet().size, 0);
  assert.equal(buildReferenceSet([[], null], []).size, 0);
});

test("a whitespace attachment id is kept", () => {
  const ids = buildReferenceSet([[" "]], undefined);
  assert.equal(ids.has(" "), true);
});

test("a reference list that is not an array throws", () => {
  assert.throws(() => buildReferenceSet("att-live", []), TypeError);
  assert.throws(() => buildReferenceSet([], "att-live"), TypeError);
  assert.throws(() => buildReferenceSet(["att-live"], []), TypeError);
  assert.throws(() => buildReferenceSet([[1]], []), TypeError);
  assert.throws(() => buildReferenceSet([["ok"]], [1]), TypeError);
  assert.throws(() => buildReferenceSet([[false]], []), TypeError);
});

test("source files import only sibling modules", () => {
  for (const name of ["inspect.js", "plan.js", "index.js"]) {
    const source = readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
    const lines = source.split("\n").filter((line) => line.startsWith("import "));
    for (const line of lines) {
      assert.match(line, /from "\.\/[a-z]+\.js";$/);
    }
    assert.equal(source.includes("node:"), false);
    assert.equal(source.includes("//"), false);
    assert.equal(source.includes("/*"), false);
  }
});
