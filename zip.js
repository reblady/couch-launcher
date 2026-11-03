'use strict';

// Kleiner ZIP-Leser für .mrpack-Dateien, damit keine Abhängigkeit nötig ist.
// Kann gespeicherte und mit Deflate komprimierte Einträge, ZIP64 braucht ein Modpack nicht.

const zlib = require('zlib');

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRY_SIZE = 1024 * 1024 * 1024;

function findEnd(buf) {
  const lowest = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  throw new Error('Keine gültige ZIP-Datei.');
}

function readEntries(buf) {
  const end = findEnd(buf);
  const count = buf.readUInt16LE(end + 10);
  let pos = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL) throw new Error('Beschädigte ZIP-Datei.');
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    entries.push({
      name: buf.toString('utf8', pos + 46, pos + 46 + nameLength),
      method: buf.readUInt16LE(pos + 10),
      compressedSize: buf.readUInt32LE(pos + 20),
      size: buf.readUInt32LE(pos + 24),
      offset: buf.readUInt32LE(pos + 42),
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function extract(buf, entry) {
  if (entry.size > MAX_ENTRY_SIZE) throw new Error('Datei im Archiv ist zu groß.');
  const pos = entry.offset;
  if (pos + 30 > buf.length || buf.readUInt32LE(pos) !== LOCAL) throw new Error('Beschädigte ZIP-Datei.');
  const start = pos + 30 + buf.readUInt16LE(pos + 26) + buf.readUInt16LE(pos + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: entry.size || 1 });
  throw new Error(`Nicht unterstützte Kompression (${entry.method}).`);
}

module.exports = { readEntries, extract };
