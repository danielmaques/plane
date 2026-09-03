/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * @description function to extract all additional assets from HTML content
 * @param htmlContent
 * @returns {string[]} array of additional asset sources
 */
const PDF_ASSET_PATH_PATTERN = /\/download\/([0-9a-f-]+)\/?(?:#.*)?$/i;

export const extractAdditionalAssetsFromHTMLContent = (htmlContent: string): string[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, "text/html");
  const assetIds = new Set<string>();
  doc.querySelectorAll("a.plane-pdf-attachment[href]").forEach((link) => {
    const assetId = link.getAttribute("href")?.match(PDF_ASSET_PATH_PATTERN)?.[1];
    if (assetId) assetIds.add(assetId);
  });
  return Array.from(assetIds);
};

/**
 * @description function to replace additional assets in HTML content with new IDs
 * @param props
 * @returns {string} HTML content with replaced additional assets
 */
export const replaceAdditionalAssetsInHTMLContent = (props: {
  htmlContent: string;
  assetMap: Record<string, string>;
}): string => {
  const { htmlContent, assetMap } = props;
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, "text/html");
  doc.querySelectorAll("a.plane-pdf-attachment[href]").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    const oldAssetId = href.match(PDF_ASSET_PATH_PATTERN)?.[1];
    if (!oldAssetId || !assetMap[oldAssetId]) return;
    link.setAttribute("href", href.replace(oldAssetId, assetMap[oldAssetId]));
  });
  return doc.body.innerHTML;
};
