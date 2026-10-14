# chunk-reap

Plan orphan upload-chunk deletes so a record is removed only when nothing references it and it is older than the grace window, and a file is removed by age alone.

Interrupted chunked uploads leave rows and storage files behind. A row is safe to remove when its filename is a chunk name, nothing in the reference set names its id, and its created time is outside the grace window. A storage file is safe to remove when its name is a chunk name and its mtime is outside that window. The file rule does not read the reference set, and the record rule does not read mtimes. This module returns that plan. It does not delete the row or the file.

## Install

The package is an ES module. It needs Node.js 20 or newer. It has no runtime dependencies. The package name is `@aneron/chunk-reap`. It is not published to the npm registry.

Clone this repository and run the tests:

```bash
git clone https://github.com/ANERON-GAMES/chunk-reap.git
cd chunk-reap
npm install
npm test
```

`npm test` runs `node --test`. `npm run lint` runs ESLint. `npm run format:check` runs Prettier.

Install it as a dependency from the git repository:

```bash
npm install github:ANERON-GAMES/chunk-reap
```

```js
import { buildReferenceSet, planOrphanCleanup } from "@aneron/chunk-reap";
```

Code in this repository imports the same entry point with `./src/index.js`.

## Usage

Pass records, files, the reference set, and the clock. `createdMs` and `mtimeMs` are milliseconds. `nowMs` is the caller's clock. The default grace window is 24 hours.

```js
import { GRACE_MS, buildReferenceSet, planOrphanCleanup } from "@aneron/chunk-reap";

const nowMs = Date.parse("2026-06-01T00:00:00.000Z");

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
    {
      id: "rec-young",
      filename: "chunk_1",
      createdMs: nowMs - GRACE_MS + 1,
      sha256: "ab".repeat(32)
    },
    {
      id: "rec-old",
      filename: "chunk_2",
      createdMs: nowMs - GRACE_MS - 1,
      sha256: "cd".repeat(32)
    },
    {
      id: "att-old",
      filename: "upload_part3",
      createdMs: nowMs - GRACE_MS - 1,
      sha256: "ef".repeat(32)
    },
    {
      id: "rec-photo",
      filename: "photo.jpg",
      createdMs: nowMs - GRACE_MS * 30
    },
    {
      id: "rec-legacy",
      filename: "chunk_4",
      createdMs: nowMs - 1,
      sha256: "pending"
    },
    {
      id: "rec-legacy-old",
      filename: "chunk_5",
      createdMs: nowMs - GRACE_MS - 1,
      sha256: "pending"
    }
  ],
  files: [
    {
      path: "/var/data/uploads/chunk_2",
      name: "chunk_2",
      mtimeMs: nowMs - GRACE_MS - 1
    },
    {
      path: "/var/data/uploads/chunk_1",
      name: "chunk_1",
      mtimeMs: nowMs - GRACE_MS + 1
    },
    {
      path: "/var/data/uploads/upload_part3",
      name: "upload_part3",
      mtimeMs: nowMs - GRACE_MS - 1
    },
    {
      path: "/var/data/uploads/photo.jpg",
      name: "photo.jpg",
      mtimeMs: nowMs - GRACE_MS * 30
    }
  ]
});
```

`referencedIds` is a set of `"att-live"` and `"att-old"`. Empty strings and null entries are skipped.

`plan.records.deleteIds` is `["rec-old", "rec-legacy-old"]`. `rec-young` is one millisecond inside the window. `att-old` is older than the window and is referenced, so the row stays. `rec-photo` is a finished object, so the filename rule keeps it. `rec-legacy` is inside the window, so the row stays. `rec-legacy-old` is outside the window and unreferenced, so the row is planned for delete. Both `"pending"` hashes are chunk rows, so `plan.records.legacyNoSha256` is `2`. The hash does not choose either of those two outcomes. `plan.records.totalChunks` is `5`. `plan.records.missingCreated` is `0`.

`plan.files.deletePaths` is `["/var/data/uploads/chunk_2", "/var/data/uploads/upload_part3"]`. `upload_part3` is planned for delete even though the record `att-old` stays. `chunk_1` stays because its age is one millisecond inside the window, which is a separate decision from the record plan. `photo.jpg` is not a chunk filename.

The caller deletes. The module does not.

A caller that already has a directory of stored objects can build the file list and then ask for the file plan. This walk is caller code. The package does not import the filesystem.

```js
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { planFileDeletes } from "@aneron/chunk-reap";

const directory = "/var/data/uploads";
const names = await readdir(directory);
const files = [];

for (const name of names) {
  const path = join(directory, name);
  const info = await stat(path);
  if (!info.isFile()) {
    continue;
  }
  files.push({ path, name, mtimeMs: info.mtimeMs });
}

const filePlan = planFileDeletes({
  files,
  nowMs: Date.now()
});
```

`filePlan.deletePaths` lists the chunk files whose age is greater than the grace window. Removing those paths is the caller's write.

## API reference

All functions are pure. They do not read the clock, the filesystem, or a database. They do not mutate their arguments. They do not delete anything.

### Constants

| Export           | Value                 | Meaning                                                                                         |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| `GRACE_MS`       | `24 * 60 * 60 * 1000` | The default grace window, 24 hours, in milliseconds. `86400000`.                                |
| `SHA256_HEX_LEN` | `64`                  | The length of a sha256 hex digest. `isSha256Hex` uses this length after trim and `toLowerCase`. |

### `isChunkFilename(name)`

Return `true` when `name` is a chunk filename.

| Argument | Type   | Role                                |
| -------- | ------ | ----------------------------------- |
| `name`   | string | The filename, not a directory path. |

The result is `true` when `name` is a string and either of these holds:

1. `name` includes the substring `_part`.
2. `name` starts with the prefix `chunk_`.

The tests are case-sensitive. `chunk_1`, `chunk_`, `upload_part3`, `upload_partial`, and `_part` are chunk names. `photo.jpg`, `partial`, `partition`, `chunk`, `xchunk_1`, `Chunk_1`, and `CHUNK_1` are not. A leading space fails the prefix test. The function does not take a basename and does not trim.

A non-string returns `false`. `null`, a number, an array, and an object are not chunk filenames.

### `isSha256Hex(value)`

Return `true` when `value` is a sha256 hex digest.

| Argument | Type   | Role        |
| -------- | ------ | ----------- |
| `value`  | string | The digest. |

A non-string returns `false`. A string is trimmed, then lowercased, then matched against `/^[a-f0-9]{64}$/`. The pattern length is `SHA256_HEX_LEN`.

An already-lowercase 64-digit digest passes. An uppercase or mixed-case digest passes because of `toLowerCase`. Surrounding whitespace passes because of `trim`. A shorter string, a longer string, a non-hex character, and an internal space fail. The original string is not required to be lowercase before normalization.

`isSha256Hex` does not authorize a delete. `planRecordDeletes` uses it only to count `legacyNoSha256`.

### `buildReferenceSet(attachmentIdLists, messageAttachmentIds)`

Return the set of referenced record ids.

| Argument               | Type                     | Role                                                     |
| ---------------------- | ------------------------ | -------------------------------------------------------- |
| `attachmentIdLists`    | array of arrays, or null | Nested lists of attachment ids. Omitted means none.      |
| `messageAttachmentIds` | array, or null           | Flat list of message attachment ids. Omitted means none. |

`null` and `undefined` for either argument mean an empty contribution. Any other non-array throws `TypeError`.

Each entry of `attachmentIdLists` is one list. `null` and `undefined` entries are skipped. Any other non-array entry throws `TypeError`.

An id is skipped when it is `null`, `undefined`, or `""`. Any other non-string throws `TypeError`. Every remaining string is added. A string of spaces is kept. Membership is exact, with no extra trim and no case folding.

The result is a new `Set`. Later edits to the input arrays do not change it. An id that appears in both places is stored once. The set is the `referencedIds` value `planRecordDeletes` reads.

### `planRecordDeletes({ records, referencedIds, nowMs, graceMs? })`

Plan record deletes.

The argument must be a non-array object. Any other value throws `TypeError`.

| Field           | Type                  | Role                                                             |
| --------------- | --------------------- | ---------------------------------------------------------------- |
| `records`       | array                 | Rows to judge. Required.                                         |
| `referencedIds` | `Set`, array, or null | Ids that protect a row. Omitted and `null` protect nothing.      |
| `nowMs`         | number                | The caller's clock, in milliseconds. Required.                   |
| `graceMs`       | number                | Grace window in milliseconds. Omitted and `null` use `GRACE_MS`. |

`records` must be an array. Each entry must be a non-array object with a non-empty string `id`. A bad row throws `TypeError` and no plan is returned.

`referencedIds` may be a `Set`, an array, `null`, or omitted. Any other value throws `TypeError`. An array is copied into a `Set` for the call. A `Set` is read as given and is not mutated. Membership uses `Set.prototype.has` on `record.id`, so the id string must be the same string that entered the set.

`nowMs` must be a finite number. Any other value throws `TypeError`. `graceMs`, when present and not `null`, must be a finite number of zero or more. Any other value throws `RangeError`.

Each record uses these fields:

| Field       | Type             | Role                                                               |
| ----------- | ---------------- | ------------------------------------------------------------------ |
| `id`        | string           | The id a reference would name. Required, non-empty.                |
| `filename`  | string           | Passed to `isChunkFilename`. A non-string is not a chunk filename. |
| `createdMs` | number           | Created time in milliseconds.                                      |
| `sha256`    | string, optional | Passed to `isSha256Hex` when the row is a chunk.                   |

Extra fields are ignored. They are not copied onto the plan.

The return value is `{ deleteIds, totalChunks, legacyNoSha256, missingCreated }`.

| Field            | Type     | Meaning                                                                                       |
| ---------------- | -------- | --------------------------------------------------------------------------------------------- |
| `deleteIds`      | string[] | Ids planned for delete, in input order, one entry per qualifying row. Duplicate ids are kept. |
| `totalChunks`    | number   | How many rows have a chunk filename.                                                          |
| `legacyNoSha256` | number   | How many of those chunk rows fail `isSha256Hex`.                                              |
| `missingCreated` | number   | How many of those chunk rows have a `createdMs` that is not a finite number.                  |

For each row, in order:

1. A filename that fails `isChunkFilename` stays. It adds nothing to the four results.
2. The row counts toward `totalChunks`.
3. A `sha256` that fails `isSha256Hex` counts toward `legacyNoSha256`. A missing hash fails. An uppercase 64-hex digest passes. This count does not decide the delete.
4. A `createdMs` that is not a finite number counts toward `missingCreated`, and the row stays. `null`, `undefined`, `NaN`, infinities, numeric strings, and booleans are unusable. A negative finite timestamp is usable, and it is old.
5. When `createdMs > nowMs - graceMs`, the row is younger than the grace window, and it stays.
6. When `referencedIds` has `id`, the row stays.
7. Otherwise the id is appended to `deleteIds`.

A timestamp equal to `nowMs - graceMs` is old enough. The youth test is strict. A timestamp after `nowMs` is younger than the window and stays.

`legacyNoSha256` includes chunk rows that stay and chunk rows that are planned for delete. An old unreferenced chunk with a hash of `"pending"` is planned for delete because it is old and unreferenced. A young chunk with that same hash stays, and the counter still moves.

### `planFileDeletes({ files, nowMs, graceMs? })`

Plan file deletes.

The argument must be a non-array object. Any other value throws `TypeError`.

| Field     | Type   | Role                                                             |
| --------- | ------ | ---------------------------------------------------------------- |
| `files`   | array  | File entries to judge. Required.                                 |
| `nowMs`   | number | The caller's clock, in milliseconds. Required.                   |
| `graceMs` | number | Grace window in milliseconds. Omitted and `null` use `GRACE_MS`. |

`files` must be an array. Each entry must be a non-array object. A bad entry throws `TypeError`. `nowMs` and `graceMs` use the same rules as `planRecordDeletes`.

Each file uses these fields:

| Field     | Type   | Role                                                                            |
| --------- | ------ | ------------------------------------------------------------------------------- |
| `path`    | string | The path copied into the plan when the file is old enough. Required for chunks. |
| `name`    | string | Passed to `isChunkFilename`. A non-string is not a chunk filename.              |
| `mtimeMs` | number | Modification time in milliseconds.                                              |

The return value is `{ deletePaths }`.

| Field         | Type     | Meaning                                                                                        |
| ------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `deletePaths` | string[] | Paths planned for delete, in input order, one entry per qualifying file. Duplicate paths stay. |

For each file, in order:

1. A name that fails `isChunkFilename` stays. The path is not read. A chunk-like path with a finished name stays.
2. `path` must be a non-empty string. Any other path throws `TypeError` and no plan is returned. The check runs for every chunk file, including one whose age would keep it.
3. An `mtimeMs` that is not a finite number stays. There is no separate counter. A negative finite mtime is usable, and it is old.
4. When `nowMs - mtimeMs > graceMs`, the path is appended to `deletePaths`.

A file whose age equals `graceMs` stays. The age test is strict. With the default window, a file is planned for delete when its age is greater than 24 hours. A custom `graceMs` uses that same strict comparison in milliseconds, and the 24 hour reading applies only when `graceMs` is `GRACE_MS`.

References are not an argument. A path is judged from its name, its mtime, and the clock.

### `planOrphanCleanup(input)`

Run both plans.

`input` must be a non-array object. Any other value throws `TypeError`. The object uses the fields of `planRecordDeletes` and `planFileDeletes` together: `records`, `files`, `referencedIds`, `nowMs`, and optional `graceMs`. One `graceMs` is passed to both plans. One `nowMs` is passed to both plans.

The return value is `{ records, files }`. `records` is the `planRecordDeletes` result. `files` is the `planFileDeletes` result. A throw from either plan returns nothing.

Calling `planOrphanCleanup` with a given input returns the same two plans as calling `planRecordDeletes` and `planFileDeletes` with that input. The file plan still ignores `referencedIds`. The record plan still ignores `files`.

## Design notes

The module answers a planning question. An interrupted chunked upload can leave a row, a storage file, or both. Deleting either one is a write, and the write stays with the caller. The functions take data the caller already loaded and return ids and paths. They do not open a database, walk a directory, stat a file, or unlink a path. The directory walk in the usage section is an example of how a caller can prepare `files`. It is not part of the package.

The grace window is the time an in-flight upload is allowed to exist with no reference yet. A chunk younger than the window stays, including a chunk that nobody references. The caller passes `nowMs`, so a test can pin the clock and a scheduler can choose when "now" is. `GRACE_MS` is 24 hours. A caller with a shorter or longer hold passes `graceMs`. Zero is a legal window. A negative window throws.

Records and files are different populations. The reference set names record ids. It does not name paths. A row can outlive its file, and a file can outlive its row, so each plan is complete on its own inputs. An old unreferenced row is planned for delete while a young file of the same upload stays. An old chunk file is planned for delete while a referenced row of the same upload stays. `planOrphanCleanup` is the pair of those decisions. It does not intersect them.

The record age rule keeps a row while `createdMs` is greater than `nowMs - graceMs`. A created time on that cutoff is old enough, once the filename is a chunk and the id is absent from the reference set. The file age rule plans a delete when `nowMs - mtimeMs` is greater than `graceMs`. A file whose age equals the window stays. On the default window that file rule is an age greater than 24 hours. The two cutoffs meet the two formulas. A caller who wants one policy at the exact millisecond can move the timestamp by a millisecond, or pass a grace value that puts the sample on the side they want.

A missing created time cannot prove that a chunk is old, so the row stays. `missingCreated` counts those chunk rows. A missing mtime cannot prove that a file is old, so the path stays, and the caller still has the file list they passed in. A negative finite timestamp is a real number, so it is old enough for its own rule.

Chunk filenames are a string rule. The substring `_part` marks a part file, including a name such as `upload_partial`. The prefix `chunk_` marks the other chunk shape. `partial` alone has no underscore, and `Chunk_1` does not have the lowercase prefix, so both stay. The rule does not parse directories. Callers pass `filename` and `name` as the stored name. A path is only the string copied into `deletePaths`.

`sha256` is a census, not a verdict. Older rows may lack a 64-hex digest. `legacyNoSha256` counts chunk rows in that state so a caller can see the residue. The delete decision remains filename, age, and references. A young row with a bad hash stays. An old unreferenced row with a good hash is still planned for delete. An old unreferenced row with a bad hash is planned for delete for the same age and reference reasons, and the counter includes it.

`buildReferenceSet` is the union of two id sources a caller may already have: nested attachment id lists, and one flat list of message attachment ids. Null lists, null ids, and empty strings are holes in that data, and they are skipped. A non-string id throws, because dropping it would look like "not referenced" and the plan would offer the row for delete. The set is a snapshot taken at the call.

Returned arrays are new on every call. The input records, files, and reference set are not modified. A `Set` passed as `referencedIds` is read during the call and is not copied. An array passed as `referencedIds` is copied into a set for the lookup.

## License

Released under the MIT License. The full text is in [LICENSE](LICENSE).
