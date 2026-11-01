import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { ToolExecutionComponent, getPackageDir } from "@earendil-works/pi-coding-agent";
import { Container, Image, Text, getCapabilities, getCellDimensions, setCapabilities, setCellDimensions, type TUI } from "@earendil-works/pi-tui";
import { ImageGrid } from "../compact-activity/image-grid.ts";
import { installActivityView } from "../compact-activity/index.ts";

const photon = createRequire(join(getPackageDir(), "package.json"))("@silvia-odwyer/photon-node");
function withImages(protocol: "kitty" | "iterm2", run: () => void) {
  const capabilities = getCapabilities();
  const cells = getCellDimensions();
  setCapabilities({ ...capabilities, images: protocol });
  setCellDimensions({ widthPx: 10, heightPx: 20 });
  try { run(); } finally { setCapabilities(capabilities); setCellDimensions(cells); }
}
function image(color: [number, number, number], width = 2, height = 2, maxWidthCells = 12): Image {
  const pixels = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([...color, 255], offset);
  const raw = new photon.PhotonImage(pixels, width, height);
  try {
    return new Image(Buffer.from(raw.get_bytes()).toString("base64"), "image/png", { fallbackColor: (text) => text }, { maxWidthCells });
  } finally { raw.free(); }
}
function rowImages(grid: ImageGrid): Image[] { return grid.children.filter((child) => child instanceof Image) as Image[]; }
function readPixels(image: Image) {
  const data = (image as unknown as { base64Data: string }).base64Data;
  const decoded = photon.PhotonImage.new_from_byteslice(Buffer.from(data, "base64"));
  try { return { pixels: decoded.get_raw_pixels(), width: decoded.get_width(), height: decoded.get_height() }; }
  finally { decoded.free(); }
}
const colors: [number, number, number][] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255], [128, 128, 128]];

for (const protocol of ["kitty", "iterm2"] as const) {
  test(`${protocol}: previews flow horizontally, wrap in order, and use less vertical space`, () => {
    withImages(protocol, () => {
      const originals = colors.map((color) => image(color));
      const grid = new ImageGrid(); grid.images = originals;
      const lines = grid.render(42); // 40 usable cells = three 12-cell images and two 2-cell gaps.
      const rows = rowImages(grid);
      assert.equal(rows.length, 3);
      assert.equal(rows[2], originals[6], "single image on the last row stays native");
      assert.ok(lines.length < originals.reduce((sum, original) => sum + original.render(42).length + 1, 0));
      const first = readPixels(rows[0]);
      assert.equal(first.width, 400);
      assert.equal(first.height, 120);
      const at = (x: number, y: number) => [...first.pixels.subarray((y * first.width + x) * 4, (y * first.width + x) * 4 + 4)];
      assert.deepEqual(at(60, 60), [255, 0, 0, 255]);
      assert.deepEqual(at(200, 60), [0, 255, 0, 255]);
      assert.deepEqual(at(340, 60), [0, 0, 255, 255]);
      assert.equal(at(130, 60)[3], 0, "gaps have no background fill");
      const second = readPixels(rows[1]);
      assert.deepEqual([...second.pixels.subarray((60 * second.width + 60) * 4, (60 * second.width + 60) * 4 + 4)], [255, 255, 0, 255]);
      grid.render(42);
      assert.deepEqual(rowImages(grid), rows, "unchanged rows keep their cached PNGs and image IDs");
      const extra = image([24, 48, 72]);
      grid.images = [...originals, extra];
      grid.render(42);
      assert.equal(rowImages(grid)[0], rows[0]);
      assert.equal(rowImages(grid)[1], rows[1]);
      grid.render(28);
      assert.equal(rowImages(grid).length, 4, "narrowing the terminal reflows the same previews");
    });
  });
}

test("collapsed tool gallery becomes original individual images on expansion, without duplicates", () => {
  withImages("kitty", () => {
    const originals = colors.slice(0, 3).map((color) => image(color));
    const content = originals.map((source) => ({ type: "image", mimeType: "image/png",
      data: (source as unknown as { base64Data: string }).base64Data }));
    const source = new ToolExecutionComponent("read", "gallery", { path: "frames.png" }, { imageWidthCells: 12 }, {
      renderCall: () => new Text("read frames.png", 0, 0), renderResult: () => new Text("", 0, 0),
    }, { requestRender() {} } as TUI, "/tmp");
    source.updateResult({ content, isError: false });
    const nativeImages = (source as unknown as { imageComponents: Image[] }).imageComponents;
    const chat = new Container(); chat.addChild(source);
    const { view } = installActivityView(chat, () => {}, (text) => text, () => false);
    const collapsed = chat.render(42).join("\n");
    assert.equal((collapsed.match(/\x1b_G/g) ?? []).length, 1, "one composed row, not three vertically stacked images");
    assert.doesNotMatch(collapsed, /frames\.png/);
    view.toggleLatestGroup();
    const expanded = chat.render(42).join("\n");
    assert.equal((expanded.match(/\x1b_G/g) ?? []).length, 3);
    assert.match(expanded, /frames\.png/);
    view.toggleLatestGroup();
    assert.equal(chat.render(42).join("\n"), collapsed, "collapse restores the cached gallery row and its image ID");
    assert.deepEqual((source as unknown as { imageComponents: Image[] }).imageComponents, nativeImages);
  });
});

test("image width/height caps and aspect ratios remain bounded", () => {
  withImages("kitty", () => {
    const wide = image([255, 0, 0], 4, 2);
    const tall = image([0, 255, 0], 1, 3);
    const grid = new ImageGrid(); grid.images = [wide, tall];
    grid.render(42);
    const rows = rowImages(grid);
    assert.equal(rows.length, 1);
    const sheet = readPixels(rows[0]);
    assert.equal(sheet.width, 180, "12-cell wide image + gap + 4-cell portrait at its native height cap");
    assert.equal(sheet.height, 120);
    const at = (x: number, y: number) => [...sheet.pixels.subarray((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4)];
    assert.deepEqual(at(60, 30), [255, 0, 0, 255]);
    assert.equal(at(60, 90)[3], 0, "landscape preview is not stretched to the portrait's height");
    assert.deepEqual(at(160, 90), [0, 255, 0, 255]);
  });
});

test("EXIF-rotated JPEG previews keep their oriented aspect ratio", () => {
  withImages("kitty", () => {
    const pixels = new Uint8Array(4 * 2 * 4).fill(255);
    const raw = new photon.PhotonImage(pixels, 4, 2);
    let jpeg: Buffer;
    try { jpeg = Buffer.from(raw.get_bytes_jpeg(90)); } finally { raw.free(); }
    // APP1/Exif: little-endian TIFF with orientation 6 (90 degrees clockwise).
    const exif = Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0,
      1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]);
    const header = Buffer.from([0xff, 0xe1, 0, exif.length + 2]);
    const data = Buffer.concat([jpeg.subarray(0, 2), header, exif, jpeg.subarray(2)]).toString("base64");
    const gallery = new ImageGrid();
    gallery.images = Array.from({ length: 2 }, () => new Image(data, "image/jpeg",
      { fallbackColor: (text) => text }, { maxWidthCells: 12 }));
    gallery.render(42);
    const sheet = readPixels(rowImages(gallery)[0]);
    assert.equal(sheet.width, 140, "two 6-cell portrait previews and a 2-cell gap");
    assert.equal(sheet.height, 120);
  });
});

test("single-column previews reuse the exact original images", () => {
  withImages("kitty", () => {
    const originals = colors.slice(0, 3).map((color) => image(color));
    const grid = new ImageGrid(); grid.images = originals;
    grid.render(14);
    assert.deepEqual(rowImages(grid), originals);
    grid.images = [];
    assert.deepEqual(grid.render(42), []);
  });
});

test("unknown preview components are retained in their original order", () => {
  withImages("kitty", () => {
    const grid = new ImageGrid();
    const separator = new Text("CUSTOM PREVIEW", 0, 0);
    const first = image([255, 0, 0]);
    const last = image([0, 255, 0]);
    grid.images = [first, separator, last];
    const lines = grid.render(42);
    assert.deepEqual(rowImages(grid), [first, last]);
    assert.ok(lines.some((line) => line.includes("CUSTOM PREVIEW")));
    assert.ok(grid.children.indexOf(separator) > grid.children.indexOf(first));
    assert.ok(grid.children.indexOf(separator) < grid.children.indexOf(last));
  });
});
