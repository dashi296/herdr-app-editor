import { expect, test } from "bun:test";
import { isImagePath } from "../../src/core/media/media";

test("the formats the host displays are images, in any case", () => {
  for (const p of ["a.png", "/p/b.JPG", "c.jpeg", "d.gif", "e.webp", "f.bmp", "g.tif", "h.TIFF", "C:\\p\\i.png"])
    expect(isImagePath(p)).toBe(true);
});

test("svg stays text; formats the host cannot display, dotfiles and extensionless names are not images", () => {
  for (const p of ["a.svg", "a.avif", "a.heic", "a.pdf", "a.png.txt", ".png", "png", "/p.png/readme"])
    expect(isImagePath(p)).toBe(false);
});
