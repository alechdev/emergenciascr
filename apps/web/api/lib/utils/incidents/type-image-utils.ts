import {
  buildImgproxyUrl as buildImgproxyUrlBase,
  buildOriginalSourceUrl as buildOriginalSourceUrlBase
} from "@api/lib/imgproxy";
import { existsInS3 } from "@api/lib/s3";

const IMAGE_SIZE = 256;

/**
 * Get the S3 key for an incident type image.
 */
function getS3Key(code: string): string {
  return `types/${code}.png`;
}

/**
 * Get parent codes for fallback logic.
 * For example: "6.1.1.2.1" -> ["6.1.1.2", "6.1.1", "6.1", "6"]
 */
function getParentCodes(code: string): string[] {
  const parts = code.split(".");
  const parents: string[] = [];

  for (let i = parts.length - 1; i > 0; i--) {
    parents.push(parts.slice(0, i).join("."));
  }

  return parents;
}

/**
 * Find the first available image for an incident type code.
 * Checks the exact code first, then parent codes in order.
 * Returns the code that has an image, or null if none found.
 */
async function findAvailableImageCode(code: string): Promise<string | null> {
  // Check exact code first
  const exactKey = getS3Key(code);
  if (await existsInS3(exactKey)) {
    return code;
  }

  // Check parent codes
  const parentCodes = getParentCodes(code);
  for (const parentCode of parentCodes) {
    const parentKey = getS3Key(parentCode);
    if (await existsInS3(parentKey)) {
      return parentCode;
    }
  }

  return null;
}

/**
 * Build the URL for the original image endpoint (used by imgproxy).
 */
function buildOriginalSourceUrl(code: string): string {
  return buildOriginalSourceUrlBase(`types/${code}/image/original`);
}

/**
 * Build the imgproxy URL for an incident type image.
 * Resizes to 256x256 for consistent icon size.
 */
function buildImgproxyUrl(sourceUrl: string): string {
  return buildImgproxyUrlBase(sourceUrl, { width: IMAGE_SIZE, height: IMAGE_SIZE });
}

export {
  buildImgproxyUrl,
  buildOriginalSourceUrl,
  findAvailableImageCode,
  getParentCodes,
  getS3Key
};
