/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { JSONContent } from "@tiptap/core";
// constants
import { PDF_ATTACHMENT_CLASS } from "@/constants/config";

export type TPdfPageImportDocument = {
  file: File;
  path: string;
  title: string;
};

export type TPdfPageImportValidationError = {
  file: File;
  message: string;
  path: string;
};

export type TPdfPageImportManifest = {
  documents: TPdfPageImportDocument[];
  errors: TPdfPageImportValidationError[];
};

const getRelativePath = (file: File): string =>
  (file.webkitRelativePath || file.name).replaceAll("\\", "/").replace(/^\.\//, "");

const truncateTitle = (title: string): string => Array.from(title.trim()).slice(0, 255).join("");

const fileNameToTitle = (name: string): string => truncateTitle(name.replace(/\.pdf$/i, "")) || "Untitled";

export const formatPdfPageFileSize = (size: number): string => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export const buildPdfPageImportManifest = (selectedFiles: File[], sizeLimit: number): TPdfPageImportManifest => {
  const documents: TPdfPageImportDocument[] = [];
  const errors: TPdfPageImportValidationError[] = [];

  selectedFiles.forEach((file) => {
    const path = getRelativePath(file);
    try {
      const hasPdfExtension = file.name.toLowerCase().endsWith(".pdf");
      const hasGenericMimeType = !file.type || file.type === "application/octet-stream";
      if (!hasPdfExtension || (!hasGenericMimeType && file.type !== "application/pdf")) {
        throw new Error("Only PDF files are supported.");
      }
      if (file.size <= 0 || file.size > sizeLimit) {
        throw new Error(`PDF file exceeds the ${formatPdfPageFileSize(sizeLimit)} size limit.`);
      }

      const normalizedFile = hasGenericMimeType
        ? new File([file], file.name, { lastModified: file.lastModified, type: "application/pdf" })
        : file;
      documents.push({ file: normalizedFile, path, title: fileNameToTitle(file.name) });
    } catch (error) {
      errors.push({
        file,
        message: error instanceof Error ? error.message : "Invalid PDF file.",
        path,
      });
    }
  });

  if (selectedFiles.length === 0) {
    errors.push({
      file: new File([], "document.pdf", { type: "application/pdf" }),
      message: "No PDF files were selected.",
      path: "",
    });
  }

  return { documents, errors };
};

export const buildPdfPageDocument = (args: { assetDownloadUrl: string; file: File }): JSONContent => {
  const { assetDownloadUrl, file } = args;
  const href = `${assetDownloadUrl.split("#")[0]}#plane-pdf=${encodeURIComponent(file.name)}&size=${file.size}`;

  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `${file.name} · ${formatPdfPageFileSize(file.size)}`,
            marks: [
              {
                type: "link",
                attrs: {
                  class: PDF_ATTACHMENT_CLASS,
                  href,
                  rel: "noopener noreferrer nofollow",
                  target: "_blank",
                },
              },
            ],
          },
        ],
      },
    ],
  };
};
