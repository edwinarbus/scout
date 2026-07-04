import { describe, it, expect } from "vitest";
import { isPlaceholderDimension, isPlaceholderPhotoUrl } from "@/lib/photo";

describe("isPlaceholderPhotoUrl", () => {
  it("flags self-identifying placeholder URLs", () => {
    for (const url of [
      "https://x/no_pic_d.jpg",
      "https://x/No-Image.png",
      "https://x/photo-coming-soon.jpg",
      "https://x/coming_soon.jpeg",
      "https://x/placeholder.svg",
      "https://x/generic.png",
      "https://petharbor.com/Images/no_pic_d.jpg",
    ]) {
      expect(isPlaceholderPhotoUrl(url), url).toBe(true);
    }
  });

  it("keeps real photo URLs (incl. petharbor's get_image, which needs resolving)", () => {
    for (const url of [
      "https://daccanimalimagesprod.blob.core.windows.net/images/A5768901.jpg",
      "https://petharbor.com/get_image.asp?RES=Detail&ID=A2280967&LOCATION=LACT2",
      "https://cdn.shelterluv.com/photos/12345.jpg",
    ]) {
      expect(isPlaceholderPhotoUrl(url), url).toBe(false);
    }
    expect(isPlaceholderPhotoUrl(null)).toBe(false);
    expect(isPlaceholderPhotoUrl(undefined)).toBe(false);
  });
});

describe("isPlaceholderDimension", () => {
  it("matches petharbor's 160×120 no_pic graphic", () => {
    expect(isPlaceholderDimension(160, 120)).toBe(true);
  });
  it("does not match real photo sizes or a transposed placeholder", () => {
    expect(isPlaceholderDimension(600, 800)).toBe(false);
    expect(isPlaceholderDimension(1024, 768)).toBe(false);
    expect(isPlaceholderDimension(120, 160)).toBe(false);
  });
});
