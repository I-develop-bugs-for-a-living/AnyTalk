/**
 * Minimal zip writer for exports: files are stored uncompressed, which every
 * unzip tool reads and is plenty for a handful of small text files
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * CRC-32 as used by zip
 * @param data Bytes
 * @returns Checksum
 */
export function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Date and time in MS-DOS format, as zip stores them */
function dosDateTime(date: Date) {
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date:
      ((Math.max(1980, date.getFullYear()) - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

/**
 * Pack text files into a zip archive
 * @param files File names (unique) and contents
 * @param modified Modification time stored for every file
 * @returns Zip file bytes
 */
export function zipFiles(
  files: { name: string; text: string }[],
  modified = new Date(),
): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(modified);

  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);

    // local file header
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0x0800, true); // UTF-8 names
    header.setUint16(8, 0, true); // stored
    header.setUint16(10, time, true);
    header.setUint16(12, date, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);
    header.setUint16(28, 0, true);

    local.push(new Uint8Array(header.buffer), name, data);

    // central directory entry
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true); // version made by
    entry.setUint16(6, 20, true); // version needed
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);

    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((n, part) => n + part.length, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Read the files of a zip archive, stored or deflated (what zip tools
 * write by default)
 * @param zip Zip file bytes
 * @returns Files with their names and bytes, folders left out
 * @throws If it isn't a zip archive
 */
export async function unzipFiles(
  zip: Uint8Array,
): Promise<{ name: string; data: Uint8Array }[]> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  // the end of central directory record sits at the end, before a comment
  let end = -1;
  for (
    let i = zip.length - 22;
    i >= Math.max(0, zip.length - 22 - 65535);
    i--
  ) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("Not a zip file");

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const utf8 = new TextDecoder();
  const latin1 = new TextDecoder("latin1");
  const files: { name: string; data: Uint8Array }[] = [];

  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("Broken zip");

    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = (flags & 0x0800 ? utf8 : latin1).decode(
      zip.subarray(at + 46, at + 46 + nameLength),
    );
    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;
    if (flags & 0x0001) throw new Error(`${name} is password protected`);

    // the local header's name and extra field can differ from the central one
    const start =
      offset +
      30 +
      view.getUint16(offset + 26, true) +
      view.getUint16(offset + 28, true);
    const raw = zip.subarray(start, start + size);

    if (method === 0) {
      files.push({ name, data: raw });
    } else if (method === 8) {
      const stream = new Blob([raw as Uint8Array<ArrayBuffer>])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      files.push({
        name,
        data: new Uint8Array(await new Response(stream).arrayBuffer()),
      });
    } else {
      throw new Error(`Unsupported compression in ${name}`);
    }
  }

  return files;
}
