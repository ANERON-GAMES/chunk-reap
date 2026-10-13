export const GRACE_MS = 24 * 60 * 60 * 1000;
export const SHA256_HEX_LEN = 64;

const SHA256_HEX = new RegExp(`^[a-f0-9]{${SHA256_HEX_LEN}}$`);

export function isChunkFilename(name) {
  if (typeof name !== "string") {
    return false;
  }
  return name.includes("_part") || name.startsWith("chunk_");
}

export function isSha256Hex(value) {
  if (typeof value !== "string") {
    return false;
  }
  return SHA256_HEX.test(value.trim().toLowerCase());
}

export function buildReferenceSet(attachmentIdLists, messageAttachmentIds) {
  const ids = new Set();
  addAttachmentLists(ids, attachmentIdLists);
  addMessageIds(ids, messageAttachmentIds);
  return ids;
}

function addAttachmentLists(ids, lists) {
  if (lists == null) {
    return;
  }
  if (!Array.isArray(lists)) {
    throw new TypeError("attachmentIdLists must be an array or null");
  }
  for (const list of lists) {
    if (list == null) {
      continue;
    }
    if (!Array.isArray(list)) {
      throw new TypeError("each attachment id list must be an array or null");
    }
    for (const id of list) {
      addReferenceId(ids, id);
    }
  }
}

function addMessageIds(ids, idsList) {
  if (idsList == null) {
    return;
  }
  if (!Array.isArray(idsList)) {
    throw new TypeError("messageAttachmentIds must be an array or null");
  }
  for (const id of idsList) {
    addReferenceId(ids, id);
  }
}

function addReferenceId(ids, id) {
  if (id == null || id === "") {
    return;
  }
  if (typeof id !== "string") {
    throw new TypeError("attachment id must be a string");
  }
  ids.add(id);
}
