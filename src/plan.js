import { GRACE_MS, isChunkFilename, isSha256Hex } from "./inspect.js";

export function planRecordDeletes(input) {
  const records = readRecords(input);
  const referencedIds = readReferencedIds(input.referencedIds);
  const nowMs = readNowMs(input.nowMs);
  const graceMs = readGraceMs(input.graceMs);
  const cutoff = nowMs - graceMs;
  const deleteIds = [];
  let totalChunks = 0;
  let legacyNoSha256 = 0;
  let missingCreated = 0;

  for (const record of records) {
    if (!isChunkFilename(record.filename)) {
      continue;
    }
    totalChunks += 1;
    if (!isSha256Hex(record.sha256)) {
      legacyNoSha256 += 1;
    }
    if (!isFiniteNumber(record.createdMs)) {
      missingCreated += 1;
      continue;
    }
    if (record.createdMs > cutoff) {
      continue;
    }
    if (referencedIds.has(record.id)) {
      continue;
    }
    deleteIds.push(record.id);
  }

  return {
    deleteIds,
    totalChunks,
    legacyNoSha256,
    missingCreated
  };
}

export function planFileDeletes(input) {
  const files = readFiles(input);
  const nowMs = readNowMs(input.nowMs);
  const graceMs = readGraceMs(input.graceMs);
  const deletePaths = [];

  for (const file of files) {
    if (!isChunkFilename(file.name)) {
      continue;
    }
    if (typeof file.path !== "string" || file.path.length === 0) {
      throw new TypeError("file.path must be a non-empty string");
    }
    if (!isFiniteNumber(file.mtimeMs)) {
      continue;
    }
    if (nowMs - file.mtimeMs > graceMs) {
      deletePaths.push(file.path);
    }
  }

  return {
    deletePaths
  };
}

export function planOrphanCleanup(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("input must be an object");
  }
  return {
    records: planRecordDeletes(input),
    files: planFileDeletes(input)
  };
}

function readRecords(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("input must be an object");
  }
  if (!Array.isArray(input.records)) {
    throw new TypeError("records must be an array");
  }
  for (const record of input.records) {
    if (record == null || typeof record !== "object" || Array.isArray(record)) {
      throw new TypeError("record must be an object");
    }
    if (typeof record.id !== "string" || record.id.length === 0) {
      throw new TypeError("record.id must be a non-empty string");
    }
  }
  return input.records;
}

function readFiles(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("input must be an object");
  }
  if (!Array.isArray(input.files)) {
    throw new TypeError("files must be an array");
  }
  for (const file of input.files) {
    if (file == null || typeof file !== "object" || Array.isArray(file)) {
      throw new TypeError("file must be an object");
    }
  }
  return input.files;
}

function readReferencedIds(referencedIds) {
  if (referencedIds == null) {
    return new Set();
  }
  if (referencedIds instanceof Set) {
    return referencedIds;
  }
  if (!Array.isArray(referencedIds)) {
    throw new TypeError("referencedIds must be a Set, an array, or null");
  }
  const ids = new Set();
  for (const id of referencedIds) {
    ids.add(id);
  }
  return ids;
}

function readNowMs(nowMs) {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    throw new TypeError("nowMs must be a finite number");
  }
  return nowMs;
}

function readGraceMs(graceMs) {
  if (graceMs == null) {
    return GRACE_MS;
  }
  if (typeof graceMs !== "number" || !Number.isFinite(graceMs) || graceMs < 0) {
    throw new RangeError("graceMs must be a finite number of zero or more");
  }
  return graceMs;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
