import assert from "node:assert/strict";
import test from "node:test";
import {
  GRACE_MS,
  SHA256_HEX_LEN,
  buildReferenceSet,
  planFileDeletes,
  planOrphanCleanup,
  planRecordDeletes
} from "../src/index.js";

const nowMs = Date.parse("2026-06-01T00:00:00.000Z");
const validSha = "ab".repeat(SHA256_HEX_LEN / 2);

function record(overrides) {
  return {
    id: "rec-1",
    filename: "chunk_1",
    createdMs: nowMs - GRACE_MS - 1,
    sha256: validSha,
    ...overrides
  };
}

function file(overrides) {
  return {
    path: "/var/data/uploads/chunk_1",
    name: "chunk_1",
    mtimeMs: nowMs - GRACE_MS - 1,
    ...overrides
  };
}

test("a young unreferenced chunk record is kept", () => {
  const plan = planRecordDeletes({
    nowMs,
    referencedIds: new Set(),
    records: [record({ id: "rec-young", createdMs: nowMs - GRACE_MS + 1 })]
  });

  assert.deepEqual(plan.deleteIds, []);
  assert.equal(plan.totalChunks, 1);
  assert.equal(plan.legacyNoSha256, 0);
  assert.equal(plan.missingCreated, 0);
});

test("an old unreferenced chunk record is deleted", () => {
  const plan = planRecordDeletes({
    nowMs,
    referencedIds: [],
    records: [record({ id: "rec-old" })]
  });

  assert.deepEqual(plan.deleteIds, ["rec-old"]);
  assert.equal(plan.totalChunks, 1);
});

test("a referenced old chunk record is kept", () => {
  const plan = planRecordDeletes({
    nowMs,
    referencedIds: buildReferenceSet([["att-old"]], ["att-old"]),
    records: [record({ id: "att-old", filename: "upload_part3" })]
  });

  assert.deepEqual(plan.deleteIds, []);
  assert.equal(plan.totalChunks, 1);
});

test("a non-chunk record is ignored", () => {
  const plan = planRecordDeletes({
    nowMs,
    referencedIds: null,
    records: [
      record({
        id: "rec-photo",
        filename: "photo.jpg",
        createdMs: nowMs - GRACE_MS * 30,
        sha256: "pending"
      })
    ]
  });

  assert.deepEqual(plan, {
    deleteIds: [],
    totalChunks: 0,
    legacyNoSha256: 0,
    missingCreated: 0
  });
});

test("file age is independent of records and of references", () => {
  const referencedIds = new Set(["att-old"]);
  const records = [
    record({ id: "rec-young", filename: "chunk_1", createdMs: nowMs - GRACE_MS + 1 }),
    record({ id: "rec-old", filename: "chunk_2", createdMs: nowMs - GRACE_MS - 1 }),
    record({ id: "att-old", filename: "upload_part3", createdMs: nowMs - GRACE_MS - 1 }),
    record({ id: "rec-photo", filename: "photo.jpg", createdMs: nowMs - GRACE_MS * 30 })
  ];
  const files = [
    file({ path: "/var/data/uploads/chunk_2", name: "chunk_2", mtimeMs: nowMs - GRACE_MS - 1 }),
    file({ path: "/var/data/uploads/chunk_1", name: "chunk_1", mtimeMs: nowMs - GRACE_MS + 1 }),
    file({
      path: "/var/data/uploads/upload_part3",
      name: "upload_part3",
      mtimeMs: nowMs - GRACE_MS - 1
    }),
    file({
      path: "/var/data/uploads/photo.jpg",
      name: "photo.jpg",
      mtimeMs: nowMs - GRACE_MS * 30
    })
  ];

  const plan = planOrphanCleanup({ nowMs, referencedIds, records, files });

  assert.deepEqual(plan.records.deleteIds, ["rec-old"]);
  assert.deepEqual(plan.records, planRecordDeletes({ nowMs, referencedIds, records }));
  assert.deepEqual(plan.files.deletePaths, [
    "/var/data/uploads/chunk_2",
    "/var/data/uploads/upload_part3"
  ]);
  assert.deepEqual(plan.files, planFileDeletes({ nowMs, files }));
  assert.equal(plan.records.deleteIds.includes("att-old"), false);
  assert.equal(plan.files.deletePaths.includes("/var/data/uploads/chunk_1"), false);
  assert.equal(plan.files.deletePaths.includes("/var/data/uploads/photo.jpg"), false);
});

test("an invalid sha256 is counted and does not delete a record by itself", () => {
  const plan = planRecordDeletes({
    nowMs,
    referencedIds: new Set(["rec-referenced"]),
    records: [
      record({ id: "rec-legacy-old", sha256: "pending" }),
      record({ id: "rec-valid-old", sha256: validSha }),
      record({ id: "rec-legacy-young", createdMs: nowMs - 1, sha256: "pending" }),
      record({ id: "rec-referenced", sha256: null }),
      record({ id: "rec-photo", filename: "photo.jpg", sha256: undefined }),
      record({ id: "rec-undated", createdMs: undefined, sha256: "pending" }),
      record({
        id: "rec-upper",
        createdMs: nowMs - 1,
        sha256: validSha.toUpperCase()
      })
    ]
  });

  assert.deepEqual(plan.deleteIds, ["rec-legacy-old", "rec-valid-old"]);
  assert.equal(plan.totalChunks, 6);
  assert.equal(plan.legacyNoSha256, 4);
  assert.equal(plan.missingCreated, 1);
});

test("a missing or unusable createdMs keeps the chunk and counts it", () => {
  const samples = [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, "100", true];
  const records = samples.map((createdMs, index) => {
    return record({ id: "rec-" + index, createdMs, sha256: validSha });
  });
  const plan = planRecordDeletes({
    nowMs,
    referencedIds: new Set(),
    records
  });

  assert.deepEqual(plan.deleteIds, []);
  assert.equal(plan.totalChunks, samples.length);
  assert.equal(plan.missingCreated, samples.length);
  assert.equal(plan.legacyNoSha256, 0);
});

test("the grace boundary deletes a record at the cutoff and keeps a file at the cutoff", () => {
  const records = planRecordDeletes({
    nowMs,
    referencedIds: new Set(),
    records: [
      record({ id: "rec-exact", createdMs: nowMs - GRACE_MS }),
      record({ id: "rec-inside", createdMs: nowMs - GRACE_MS + 1 }),
      record({ id: "rec-outside", createdMs: nowMs - GRACE_MS - 1 })
    ]
  });
  const files = planFileDeletes({
    nowMs,
    files: [
      file({ path: "/var/data/uploads/exact", name: "chunk_exact", mtimeMs: nowMs - GRACE_MS }),
      file({
        path: "/var/data/uploads/inside",
        name: "chunk_inside",
        mtimeMs: nowMs - GRACE_MS + 1
      }),
      file({
        path: "/var/data/uploads/outside",
        name: "chunk_outside",
        mtimeMs: nowMs - GRACE_MS - 1
      })
    ]
  });

  assert.deepEqual(records.deleteIds, ["rec-exact", "rec-outside"]);
  assert.deepEqual(files.deletePaths, ["/var/data/uploads/outside"]);
});

test("a custom grace window is shared by the record plan and the file plan", () => {
  const graceMs = 1000;
  const plan = planOrphanCleanup({
    nowMs,
    graceMs,
    referencedIds: new Set(),
    records: [
      record({ id: "rec-exact", createdMs: nowMs - graceMs }),
      record({ id: "rec-inside", createdMs: nowMs - graceMs + 1 })
    ],
    files: [
      file({ path: "/var/data/uploads/exact", name: "chunk_exact", mtimeMs: nowMs - graceMs }),
      file({ path: "/var/data/uploads/older", name: "chunk_older", mtimeMs: nowMs - graceMs - 1 })
    ]
  });

  assert.deepEqual(plan.records.deleteIds, ["rec-exact"]);
  assert.deepEqual(plan.files.deletePaths, ["/var/data/uploads/older"]);
});

test("a chunk file with an unusable mtime stays", () => {
  const plan = planFileDeletes({
    nowMs,
    files: [
      file({ path: "/var/data/uploads/missing", name: "chunk_missing", mtimeMs: undefined }),
      file({ path: "/var/data/uploads/text", name: "chunk_text", mtimeMs: "1" }),
      file({ path: "/var/data/uploads/nan", name: "chunk_nan", mtimeMs: Number.NaN }),
      file({ name: "photo.jpg" }),
      { name: "notes.txt" }
    ]
  });

  assert.deepEqual(plan.deletePaths, []);
});

test("a future timestamp stays and a negative timestamp is old enough", () => {
  const records = planRecordDeletes({
    nowMs,
    referencedIds: new Set(),
    records: [
      record({ id: "rec-future", createdMs: nowMs + 1 }),
      record({ id: "rec-negative", createdMs: -1 })
    ]
  });
  const files = planFileDeletes({
    nowMs,
    files: [
      file({ path: "/var/data/uploads/future", name: "chunk_future", mtimeMs: nowMs + 1 }),
      file({ path: "/var/data/uploads/negative", name: "chunk_negative", mtimeMs: -1 })
    ]
  });

  assert.deepEqual(records.deleteIds, ["rec-negative"]);
  assert.deepEqual(files.deletePaths, ["/var/data/uploads/negative"]);
});

test("duplicate record ids and duplicate paths are listed once per qualifying row", () => {
  const records = planRecordDeletes({
    nowMs,
    referencedIds: new Set(),
    records: [record({ id: "rec-same" }), record({ id: "rec-same" })]
  });
  const files = planFileDeletes({
    nowMs,
    files: [
      file({ path: "/var/data/uploads/same", name: "chunk_a" }),
      file({ path: "/var/data/uploads/same", name: "chunk_b" })
    ]
  });

  assert.deepEqual(records.deleteIds, ["rec-same", "rec-same"]);
  assert.deepEqual(files.deletePaths, ["/var/data/uploads/same", "/var/data/uploads/same"]);
});

test("the usage sample keeps the young chunk, the referenced chunk, and the young file", () => {
  const referencedIds = buildReferenceSet(
    [
      ["att-live", ""],
      [null, "att-old"]
    ],
    ["att-live", null, "att-old"]
  );
  const plan = planOrphanCleanup({
    nowMs,
    referencedIds,
    records: [
      record({
        id: "rec-young",
        filename: "chunk_1",
        createdMs: nowMs - GRACE_MS + 1,
        sha256: "ab".repeat(32)
      }),
      record({
        id: "rec-old",
        filename: "chunk_2",
        createdMs: nowMs - GRACE_MS - 1,
        sha256: "cd".repeat(32)
      }),
      record({
        id: "att-old",
        filename: "upload_part3",
        createdMs: nowMs - GRACE_MS - 1,
        sha256: "ef".repeat(32)
      }),
      record({
        id: "rec-photo",
        filename: "photo.jpg",
        createdMs: nowMs - GRACE_MS * 30
      }),
      record({
        id: "rec-legacy",
        filename: "chunk_4",
        createdMs: nowMs - 1,
        sha256: "pending"
      }),
      record({
        id: "rec-legacy-old",
        filename: "chunk_5",
        createdMs: nowMs - GRACE_MS - 1,
        sha256: "pending"
      })
    ],
    files: [
      file({
        path: "/var/data/uploads/chunk_2",
        name: "chunk_2",
        mtimeMs: nowMs - GRACE_MS - 1
      }),
      file({
        path: "/var/data/uploads/chunk_1",
        name: "chunk_1",
        mtimeMs: nowMs - GRACE_MS + 1
      }),
      file({
        path: "/var/data/uploads/upload_part3",
        name: "upload_part3",
        mtimeMs: nowMs - GRACE_MS - 1
      }),
      file({
        path: "/var/data/uploads/photo.jpg",
        name: "photo.jpg",
        mtimeMs: nowMs - GRACE_MS * 30
      })
    ]
  });

  assert.equal(referencedIds.size, 2);
  assert.deepEqual(plan.records.deleteIds, ["rec-old", "rec-legacy-old"]);
  assert.equal(plan.records.totalChunks, 5);
  assert.equal(plan.records.legacyNoSha256, 2);
  assert.equal(plan.records.missingCreated, 0);
  assert.deepEqual(plan.files.deletePaths, [
    "/var/data/uploads/chunk_2",
    "/var/data/uploads/upload_part3"
  ]);
});

test("plans leave their inputs unchanged and return new arrays", () => {
  const records = [record({ id: "rec-old" })];
  const files = [file()];
  const referencedIds = new Set(["other"]);
  const recordSnapshot = structuredClone(records);
  const fileSnapshot = structuredClone(files);
  const input = { nowMs, referencedIds, records, files };

  const first = planOrphanCleanup(input);
  const second = planOrphanCleanup(input);

  assert.deepEqual(records, recordSnapshot);
  assert.deepEqual(files, fileSnapshot);
  assert.equal(referencedIds.has("rec-old"), false);
  assert.equal(referencedIds.size, 1);
  assert.notEqual(first.records.deleteIds, second.records.deleteIds);
  assert.notEqual(first.files.deletePaths, second.files.deletePaths);
  assert.deepEqual(Object.keys(first.records).sort(), [
    "deleteIds",
    "legacyNoSha256",
    "missingCreated",
    "totalChunks"
  ]);
  assert.deepEqual(Object.keys(first.files), ["deletePaths"]);
  assert.deepEqual(Object.keys(first).sort(), ["files", "records"]);
});

test("an empty catalog plans nothing", () => {
  const plan = planOrphanCleanup({
    nowMs,
    graceMs: null,
    records: [],
    files: [],
    referencedIds: new Set()
  });

  assert.deepEqual(plan.records.deleteIds, []);
  assert.equal(plan.records.totalChunks, 0);
  assert.deepEqual(plan.files.deletePaths, []);
});

test("a zero grace window uses the same cutoff formulas", () => {
  const records = planRecordDeletes({
    nowMs,
    graceMs: 0,
    referencedIds: new Set(),
    records: [
      record({ id: "rec-now", createdMs: nowMs }),
      record({ id: "rec-after", createdMs: nowMs + 1 })
    ]
  });
  const files = planFileDeletes({
    nowMs,
    graceMs: 0,
    files: [
      file({ path: "/var/data/uploads/now", name: "chunk_now", mtimeMs: nowMs }),
      file({ path: "/var/data/uploads/older", name: "chunk_older", mtimeMs: nowMs - 1 })
    ]
  });

  assert.deepEqual(records.deleteIds, ["rec-now"]);
  assert.deepEqual(files.deletePaths, ["/var/data/uploads/older"]);
});

test("omitted references treat every old chunk record as unreferenced", () => {
  const plan = planRecordDeletes({
    nowMs,
    records: [record({ id: "rec-old" })]
  });

  assert.deepEqual(plan.deleteIds, ["rec-old"]);
});

test("a chunk path is copied as given and a non-chunk name skips a chunk-like path", () => {
  const plan = planFileDeletes({
    nowMs,
    files: [
      file({
        path: "/var/data/uploads/chunk_1",
        name: "photo.jpg",
        mtimeMs: nowMs - GRACE_MS * 30
      }),
      file({
        path: "/var/data/uploads/stored.bin",
        name: "chunk_9",
        mtimeMs: nowMs - GRACE_MS - 1
      })
    ]
  });

  assert.deepEqual(plan.deletePaths, ["/var/data/uploads/stored.bin"]);
});

test("bad plan input throws before a plan is returned", () => {
  assert.throws(() => planRecordDeletes(null), TypeError);
  assert.throws(() => planRecordDeletes([]), TypeError);
  assert.throws(() => planRecordDeletes({ records: null, nowMs }), TypeError);
  assert.throws(() => planRecordDeletes({ records: [null], nowMs }), TypeError);
  assert.throws(() => planRecordDeletes({ records: [{}], nowMs }), TypeError);
  assert.throws(() => planRecordDeletes({ records: [{ id: "" }], nowMs }), TypeError);
  assert.throws(() => planRecordDeletes({ records: [], referencedIds: "rec-1", nowMs }), TypeError);
  assert.throws(() => planRecordDeletes({ records: [], nowMs: "1" }), TypeError);
  assert.throws(() => planRecordDeletes({ records: [], nowMs: Number.NaN }), TypeError);
  assert.throws(() => planRecordDeletes({ records: [], nowMs, graceMs: -1 }), RangeError);
  assert.throws(
    () => planRecordDeletes({ records: [], nowMs, graceMs: Number.POSITIVE_INFINITY }),
    RangeError
  );
  assert.throws(() => planFileDeletes(null), TypeError);
  assert.throws(() => planFileDeletes({ files: null, nowMs }), TypeError);
  assert.throws(() => planFileDeletes({ files: [null], nowMs }), TypeError);
  assert.throws(
    () => planFileDeletes({ files: [{ name: "chunk_1", path: "" }], nowMs }),
    TypeError
  );
  assert.throws(() => planFileDeletes({ files: [{ name: "chunk_1" }], nowMs }), TypeError);
  assert.throws(() => planOrphanCleanup(null), TypeError);
  assert.throws(() => planOrphanCleanup([]), TypeError);
});
