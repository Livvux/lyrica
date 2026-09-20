import assert from "node:assert/strict";
import { test } from "node:test";
import { parseByteRange, type ByteRange } from "../src/lib/http-range";

const cases: Array<[string, string | null, number, ByteRange | "unsatisfiable" | null]> = [
  ["no header", null, 10, null],
  ["closed range", "bytes=2-4", 10, { start: 2, end: 4 }],
  ["single byte", "bytes=0-0", 10, { start: 0, end: 0 }],
  ["open end", "bytes=4-", 10, { start: 4, end: 9 }],
  ["suffix", "bytes=-3", 10, { start: 7, end: 9 }],
  ["suffix equals size", "bytes=-10", 10, { start: 0, end: 9 }],
  ["oversized suffix", "bytes=-50", 10, { start: 0, end: 9 }],
  ["clamp end", "bytes=2-50", 10, { start: 2, end: 9 }],
  ["zero suffix", "bytes=-0", 10, "unsatisfiable"],
  ["start at EOF", "bytes=10-", 10, "unsatisfiable"],
  ["start after EOF", "bytes=20-30", 10, "unsatisfiable"],
  ["reversed range", "bytes=7-3", 10, "unsatisfiable"],
  ["empty file", "bytes=0-", 0, "unsatisfiable"],
  ["empty file suffix", "bytes=-1", 0, "unsatisfiable"],
  ["empty file without range", null, 0, null],
  ["unit is case-insensitive", "BYTES=1-2", 10, { start: 1, end: 2 }],
  ["outer whitespace", " bytes=1-2 ", 10, { start: 1, end: 2 }],
  ["leading zeroes", "bytes=0001-0002", 10, { start: 1, end: 2 }],
  ["empty range", "bytes=-", 10, null],
  ["empty header", "", 10, null],
  ["unknown unit", "items=1-2", 10, null],
  ["multipart is ignored", "bytes=0-1,4-5", 10, null],
  ["prefix garbage", "garbage bytes=0-1", 10, null],
  ["suffix garbage", "bytes=0-1garbage", 10, null],
  ["extra separator", "bytes=0-1-2", 10, null],
  ["nondecimal", "bytes=0-1e2", 10, null],
  ["negative start", "bytes=-2-4", 10, null],
  ["overflow start", `bytes=${"9".repeat(400)}-`, 10, "unsatisfiable"],
  ["overflow end clamps", `bytes=2-${"9".repeat(400)}`, 10, { start: 2, end: 9 }],
  ["overflow suffix clamps", `bytes=-${"9".repeat(400)}`, 10, { start: 0, end: 9 }],
];
for (const [name, header, size, expected] of cases) {
  test(name, () => assert.deepEqual(parseByteRange(header, size), expected));
}

test("reject invalid file sizes instead of constructing unsafe offsets", () => {
  for (const size of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseByteRange("bytes=0-", size), RangeError);
  }
});

test("every successful small range stays within the file", () => {
  for (let size = 0; size < 20; size++) {
    for (let start = 0; start < 25; start++) {
      for (let end = 0; end < 25; end++) {
        const range = parseByteRange(`bytes=${start}-${end}`, size);
        if (range && range !== "unsatisfiable") {
          assert.ok(range.start >= 0 && range.start <= range.end && range.end < size);
          assert.ok(Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end));
        }
      }
    }
  }
});
