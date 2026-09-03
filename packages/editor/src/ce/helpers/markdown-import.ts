/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Editor, mergeAttributes, Node } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
// extensions
import { CoreEditorExtensionsWithoutProps } from "@/extensions/core-without-props";
// local imports
import { ECustomImageStatus } from "@/extensions/custom-image/types";
import { DEFAULT_CUSTOM_IMAGE_ATTRIBUTES } from "@/extensions/custom-image/utils";

export const MARKDOWN_IMPORT_IMAGE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];

const IMAGE_MIME_TYPES_BY_EXTENSION: Record<string, string[]> = {
  ".gif": ["image/gif"],
  ".jpeg": ["image/jpeg", "image/jpg"],
  ".jpg": ["image/jpeg", "image/jpg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
};

export type TMarkdownLocalImage = {
  file: File;
  references: string[];
  resolvedPath: string;
};

export type TMarkdownImportDocument = {
  content: JSONContent;
  file: File;
  images: TMarkdownLocalImage[];
  path: string;
  title: string;
};

export type TMarkdownImportValidationError = {
  file: File;
  message: string;
  path: string;
};

export type TMarkdownImportManifest = {
  documents: TMarkdownImportDocument[];
  errors: TMarkdownImportValidationError[];
};

const getRelativePath = (file: File): string =>
  (file.webkitRelativePath || file.name).replaceAll("\\", "/").replace(/^\.\//, "");

const normalizePath = (path: string): string | undefined => {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/");
};

const fileNameToTitle = (name: string): string => name.replace(/\.md$/i, "").trim() || "Untitled";

const truncateTitle = (title: string): string => Array.from(title.trim()).slice(0, 255).join("");

const getTextContent = (node: JSONContent): string =>
  [node.text ?? "", ...(node.content?.map(getTextContent) ?? [])].join("");

const ImportTable = Node.create({
  name: "table",
  group: "block",
  content: "tableRow+",
  isolating: true,
  parseHTML: () => [{ tag: "table" }],
  renderHTML: ({ HTMLAttributes }) => ["table", mergeAttributes(HTMLAttributes), ["tbody", 0]],
});

const ImportTableRow = Node.create({
  name: "tableRow",
  content: "(tableCell|tableHeader)+",
  tableRole: "row",
  parseHTML: () => [{ tag: "tr" }],
  renderHTML: ({ HTMLAttributes }) => ["tr", mergeAttributes(HTMLAttributes), 0],
});

const createImportTableCell = (name: "tableCell" | "tableHeader", tag: "td" | "th", role: "cell" | "header_cell") =>
  Node.create({
    name,
    content: "block+",
    isolating: true,
    tableRole: role,
    parseHTML: () => [{ tag }],
    renderHTML: ({ HTMLAttributes }) => [tag, mergeAttributes(HTMLAttributes), 0],
  });

const ImportTableCell = createImportTableCell("tableCell", "td", "cell");
const ImportTableHeader = createImportTableCell("tableHeader", "th", "header_cell");

const collectImageSources = (node: JSONContent, sources: Set<string>) => {
  if (node.type === "image" && typeof node.attrs?.src === "string") sources.add(node.attrs.src);
  node.content?.forEach((child) => collectImageSources(child, sources));
};

const readFileAsArrayBuffer = async (file: File): Promise<ArrayBuffer> => {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Unable to read file.")));
    reader.addEventListener("load", () => resolve(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
};

const parseMarkdown = (markdown: string, fallbackTitle: string): { content: JSONContent; title: string } => {
  const editor = new Editor({
    content: markdown,
    extensions: [
      ...CoreEditorExtensionsWithoutProps.filter(
        (extension) => !["emoji", "table", "tableCell", "tableHeader", "tableRow"].includes(extension.name)
      ),
      ImportTable,
      ImportTableRow,
      ImportTableCell,
      ImportTableHeader,
      Markdown.configure({
        breaks: true,
        html: false,
        transformCopiedText: false,
        transformPastedText: false,
      }),
    ],
  });
  const content = editor.getJSON();
  editor.destroy();

  const firstH1Index = content.content?.findIndex((node) => node.type === "heading" && node.attrs?.level === 1) ?? -1;
  const firstH1 = firstH1Index >= 0 ? content.content?.[firstH1Index] : undefined;
  const title = truncateTitle(firstH1 ? getTextContent(firstH1) : fallbackTitle) || truncateTitle(fallbackTitle);
  if (firstH1Index >= 0) content.content?.splice(firstH1Index, 1);
  if (!content.content?.length) content.content = [{ type: "paragraph" }];
  return { content, title };
};

const resolveLocalImage = (args: {
  filesByPath: Map<string, File>;
  imageSizeLimit: number;
  markdownPath: string;
  reference: string;
  rootDirectory: string;
}): TMarkdownLocalImage | undefined => {
  const { filesByPath, imageSizeLimit, markdownPath, reference, rootDirectory } = args;
  if (/^https?:\/\//i.test(reference)) return undefined;
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith("/") || reference.startsWith("#")) {
    throw new Error(`Blocked image path: ${reference}`);
  }

  let decodedReference: string;
  try {
    decodedReference = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  } catch {
    throw new Error(`Invalid image path: ${reference}`);
  }
  const parentPath = markdownPath.split("/").slice(0, -1).join("/");
  const resolvedPath = normalizePath(`${parentPath}/${decodedReference}`);
  if (!resolvedPath || !(resolvedPath === rootDirectory || resolvedPath.startsWith(`${rootDirectory}/`))) {
    throw new Error(`Image path escapes the selected folder: ${reference}`);
  }
  const file = filesByPath.get(resolvedPath);
  if (!file) throw new Error(`Local image not found: ${reference}`);
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const acceptedMimeTypes = IMAGE_MIME_TYPES_BY_EXTENSION[extension];
  const hasGenericMimeType = !file.type || file.type === "application/octet-stream";
  if (!acceptedMimeTypes || (!hasGenericMimeType && !acceptedMimeTypes.includes(file.type))) {
    throw new Error(`Unsupported local image type: ${reference} (${file.type || "unknown"})`);
  }
  if (file.size <= 0 || file.size > imageSizeLimit) {
    throw new Error(`Local image exceeds the configured size limit: ${reference}`);
  }
  const normalizedFile = hasGenericMimeType
    ? new File([file], file.name, { lastModified: file.lastModified, type: acceptedMimeTypes[0] })
    : file;
  return { file: normalizedFile, references: [reference], resolvedPath };
};

export const buildMarkdownImportManifest = async (
  selectedFiles: File[],
  limits: { imageSizeLimit: number; markdownSizeLimit: number }
): Promise<TMarkdownImportManifest> => {
  const filesByPath = new Map(selectedFiles.map((file) => [getRelativePath(file), file]));
  const markdownFiles = selectedFiles.filter((file) => file.name.toLowerCase().endsWith(".md"));
  const documents: TMarkdownImportDocument[] = [];
  const errors: TMarkdownImportValidationError[] = [];

  for (const file of markdownFiles) {
    const path = getRelativePath(file);
    try {
      if (file.size <= 0 || file.size > limits.markdownSizeLimit) {
        throw new Error("Markdown file exceeds the configured size limit.");
      }
      // Files are parsed in selection order to cap memory use for large folders.
      // eslint-disable-next-line no-await-in-loop
      const buffer = await readFileAsArrayBuffer(file);
      const markdown = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      const parsed = parseMarkdown(markdown, fileNameToTitle(file.name));
      const imageSources = new Set<string>();
      collectImageSources(parsed.content, imageSources);
      const markdownImagePattern = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g;
      for (const match of markdown.matchAll(markdownImagePattern)) {
        const reference = match[1] ?? match[2];
        if (reference) imageSources.add(reference);
      }
      const rootDirectory = path.split("/")[0];
      const uniqueImages = new Map<string, TMarkdownLocalImage>();
      imageSources.forEach((reference) => {
        const image = resolveLocalImage({
          filesByPath,
          imageSizeLimit: limits.imageSizeLimit,
          markdownPath: path,
          reference,
          rootDirectory,
        });
        if (image) {
          const existingImage = uniqueImages.get(image.resolvedPath);
          if (existingImage) existingImage.references.push(reference);
          else uniqueImages.set(image.resolvedPath, image);
        }
      });
      documents.push({
        content: parsed.content,
        file,
        images: Array.from(uniqueImages.values()),
        path,
        title: parsed.title,
      });
    } catch (error) {
      errors.push({
        file,
        message: error instanceof Error ? error.message : "Invalid Markdown file.",
        path,
      });
    }
  }

  if (markdownFiles.length === 0) {
    errors.push({
      file: selectedFiles[0] ?? new File([], "folder"),
      message: "No Markdown files were found in the selected folder.",
      path: "",
    });
  }
  return { documents, errors };
};

export const replaceMarkdownLocalImages = (
  content: JSONContent,
  assetIdsByReference: Record<string, string>
): JSONContent => {
  const replace = (node: JSONContent): JSONContent => {
    if (node.type === "image" && typeof node.attrs?.src === "string" && assetIdsByReference[node.attrs.src]) {
      const assetId = assetIdsByReference[node.attrs.src];
      return {
        type: "imageComponent",
        attrs: {
          ...DEFAULT_CUSTOM_IMAGE_ATTRIBUTES,
          alt: node.attrs.alt ?? null,
          id: assetId,
          src: assetId,
          status: ECustomImageStatus.UPLOADED,
          title: node.attrs.title ?? null,
        },
      };
    }
    return {
      ...node,
      content: node.content?.map(replace),
    };
  };
  return replace(content);
};
