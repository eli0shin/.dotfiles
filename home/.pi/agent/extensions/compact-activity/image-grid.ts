import { createRequire } from "node:module";
import { join } from "node:path";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { Container, Image, Spacer, getCapabilities, getCellDimensions, type Component } from "@earendil-works/pi-tui";

type PixelImage = {
  get_width(): number;
  get_height(): number;
  get_raw_pixels(): Uint8Array;
  get_bytes(): Uint8Array;
  free(): void;
};
type Photon = {
  PhotonImage: {
    new(pixels: Uint8Array, width: number, height: number): PixelImage;
    new_from_byteslice(bytes: Uint8Array): PixelImage;
  };
  resize(image: PixelImage, width: number, height: number, filter: number): PixelImage;
  SamplingFilter: { Lanczos3: number };
};
type Processor = {
  photon: Photon;
  orient(photon: Photon, image: PixelImage, bytes: Uint8Array): PixelImage;
};
let processor: Processor | null | undefined;
function getProcessor(): Processor | undefined {
  if (processor === undefined) {
    try {
      // Reuse Pi 1.4's own image dependency and orientation handling; no external
      // programs or second image-processing dependency are needed.
      const require = createRequire(join(getPackageDir(), "package.json"));
      processor = { photon: require("@silvia-odwyer/photon-node"),
        orient: require("./dist/utils/exif-orientation.js").applyExifOrientation };
    } catch { processor = null; }
  }
  return processor ?? undefined;
}

// Native Pi Image metadata; original components remain untouched and are still
// used individually when the group expands or only one image fits on a row.
type ImageState = {
  base64Data: string;
  mimeType: string;
  pngData?: string;
  dimensions: { widthPx: number; heightPx: number };
  options: { maxWidthCells?: number; maxHeightCells?: number };
};
type Tile = { image: Image; columns: number; widthPx: number; heightPx: number };
type Thumbnail = { key: string; pixels: Uint8Array };
type RowCache = { key: string; images: Image[]; sheet?: Image };
const GAP = 2;

export class ImageGrid extends Container {
  images: readonly Component[] = [];
  private thumbnails = new WeakMap<Image, Thumbnail>();
  private rows = new WeakMap<Image, RowCache>();
  private orientedDimensions = new WeakMap<Image, ImageState["dimensions"]>();

  private dimensions(image: Image, state: ImageState): ImageState["dimensions"] | undefined {
    if (state.mimeType !== "image/jpeg" && state.mimeType !== "image/webp") return state.dimensions;
    const cached = this.orientedDimensions.get(image);
    if (cached) return cached;
    const tools = getProcessor();
    if (!tools) return undefined;
    let original: PixelImage | undefined;
    let oriented: PixelImage | undefined;
    try {
      const bytes = Buffer.from(state.pngData ?? state.base64Data, "base64");
      original = tools.photon.PhotonImage.new_from_byteslice(bytes);
      oriented = tools.orient(tools.photon, original, bytes);
      const dimensions = { widthPx: oriented.get_width(), heightPx: oriented.get_height() };
      this.orientedDimensions.set(image, dimensions);
      return dimensions;
    } catch { return undefined; }
    finally {
      if (oriented && oriented !== original) oriented.free();
      original?.free();
    }
  }

  private tile(image: Image, available: number, cellWidth: number, cellHeight: number): Tile | undefined {
    const state = image as unknown as ImageState;
    if (!state.dimensions || !state.options || typeof state.base64Data !== "string") return undefined;
    const dimensions = this.dimensions(image, state);
    if (!dimensions || dimensions.widthPx <= 0 || dimensions.heightPx <= 0) return undefined;
    const maxColumns = Math.max(1, Math.min(available, state.options.maxWidthCells ?? 60));
    const maxRows = state.options.maxHeightCells ?? Math.ceil(maxColumns * cellWidth / cellHeight);
    const scale = Math.min(maxColumns * cellWidth / dimensions.widthPx,
      maxRows * cellHeight / dimensions.heightPx);
    const widthPx = Math.max(1, Math.round(dimensions.widthPx * scale));
    const heightPx = Math.max(1, Math.round(dimensions.heightPx * scale));
    return { image, columns: Math.min(maxColumns, Math.ceil(widthPx / cellWidth)), widthPx, heightPx };
  }

  private thumbnail(tile: Tile, tools: Processor): Uint8Array {
    const key = `${tile.widthPx}:${tile.heightPx}`;
    const cached = this.thumbnails.get(tile.image);
    if (cached?.key === key) return cached.pixels;
    const state = tile.image as unknown as ImageState;
    const bytes = Buffer.from(state.pngData ?? state.base64Data, "base64");
    const original = tools.photon.PhotonImage.new_from_byteslice(bytes);
    let oriented: PixelImage | undefined;
    let resized: PixelImage | undefined;
    try {
      oriented = tools.orient(tools.photon, original, bytes);
      resized = tools.photon.resize(oriented, tile.widthPx, tile.heightPx, tools.photon.SamplingFilter.Lanczos3);
      const pixels = resized.get_raw_pixels();
      this.thumbnails.set(tile.image, { key, pixels });
      return pixels;
    } finally {
      resized?.free();
      if (oriented && oriented !== original) oriented.free();
      original.free();
    }
  }

  private sheet(tiles: Tile[], cellWidth: number, cellHeight: number): Image | undefined {
    const key = `${getCapabilities().images}:${cellWidth}:${cellHeight}:` +
      tiles.map((tile) => `${tile.columns}:${tile.widthPx}:${tile.heightPx}`).join(",");
    const first = tiles[0].image;
    const cached = this.rows.get(first);
    if (cached?.key === key && cached.images.length === tiles.length &&
        cached.images.every((image, index) => image === tiles[index].image)) return cached.sheet;
    const row: RowCache = { key, images: tiles.map((tile) => tile.image) };
    this.rows.set(first, row);
    const tools = getProcessor();
    if (!tools) return undefined;
    try {
      const columns = tiles.reduce((sum, tile) => sum + tile.columns, 0) + GAP * (tiles.length - 1);
      const heightRows = Math.ceil(Math.max(...tiles.map((tile) => tile.heightPx)) / cellHeight);
      const widthPx = columns * cellWidth;
      const heightPx = heightRows * cellHeight;
      const pixels = new Uint8Array(widthPx * heightPx * 4); // transparent gaps and unused space
      let x = 0;
      for (const tile of tiles) {
        const thumbnail = this.thumbnail(tile, tools);
        for (let y = 0; y < tile.heightPx; y++) {
          pixels.set(thumbnail.subarray(y * tile.widthPx * 4, (y + 1) * tile.widthPx * 4),
            (y * widthPx + x) * 4);
        }
        x += (tile.columns + GAP) * cellWidth;
      }
      const canvas = new tools.photon.PhotonImage(pixels, widthPx, heightPx);
      try {
        const data = Buffer.from(canvas.get_bytes()).toString("base64");
        row.sheet = new Image(data, "image/png", { fallbackColor: (text) => text },
          { maxWidthCells: columns, maxHeightCells: heightRows });
      } finally { canvas.free(); }
      return row.sheet;
    } catch {
      // If decoding/composition fails, keep every original preview visible.
      return undefined;
    }
  }

  render(width: number): string[] {
    this.children = [];
    const cell = getCellDimensions();
    const cellWidth = Math.max(1, Math.round(cell.widthPx));
    const cellHeight = Math.max(1, Math.round(cell.heightPx));
    const available = Math.max(1, width - 2); // matches native Image's horizontal reservation
    let tiles: Tile[] = [];
    let used = 0;
    const flush = () => {
      if (!tiles.length) return;
      // Pi's line renderer retains only one graphic per terminal line. Render
      // a cached PNG strip per row so scrolling, clipping, and both protocols
      // remain native, instead of concatenating unsupported image sequences.
      const sheet = tiles.length > 1 ? this.sheet(tiles, cellWidth, cellHeight) : undefined;
      if (sheet) this.children.push(new Spacer(1), sheet);
      else for (const tile of tiles) this.children.push(new Spacer(1), tile.image);
      tiles = [];
      used = 0;
    };
    for (const image of this.images) {
      const tile = image instanceof Image ? this.tile(image, available, cellWidth, cellHeight) : undefined;
      if (!tile) {
        flush();
        this.children.push(new Spacer(1), image);
        continue;
      }
      const nextWidth = used + (tiles.length ? GAP : 0) + tile.columns;
      if (tiles.length && nextWidth > available) flush();
      used += (tiles.length ? GAP : 0) + tile.columns;
      tiles.push(tile);
    }
    flush();
    return super.render(width);
  }
}
