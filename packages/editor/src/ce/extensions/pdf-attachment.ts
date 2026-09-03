/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
// constants
import { PDF_ATTACHMENT_CLASS, PDF_ATTACHMENT_PREVIEW_EVENT } from "@/constants/config";
import { CORE_EDITOR_META } from "@/constants/meta";
// types
import type { TEditorAsset, TFileHandler, TPdfAttachmentPreviewEventDetail } from "@/types";

const PDF_EXTENSION_NAME = "pdfAttachment";
const PDF_PENDING_CLASS = `${PDF_ATTACHMENT_CLASS}--pending`;
const PDF_ERROR_CLASS = `${PDF_ATTACHMENT_CLASS}--error`;
const PDF_UPLOAD_PREFIX = "#plane-pdf-upload-";

type TPdfAttachmentCommandProps = {
  event: "drop" | "insert";
  file: File;
  pos?: number;
};

type TPdfUpload = {
  file: File;
};

type TPdfLink = TEditorAsset & {
  from: number;
  to: number;
};

type TPdfAttachmentStorage = {
  deletedAssetIds: Map<string, boolean>;
  eventHandler?: (event: Event) => void;
  newlyUploadedAssetIds: Set<string>;
  uploads: Map<string, TPdfUpload>;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pdfAttachment: {
      insertPdfAttachment: (props: TPdfAttachmentCommandProps) => ReturnType;
    };
  }

  interface Storage {
    pdfAttachment: TPdfAttachmentStorage;
  }
}

const formatFileSize = (size: number): string => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getUploadId = (href: string): string | undefined =>
  href.startsWith(PDF_UPLOAD_PREFIX) ? href.slice(PDF_UPLOAD_PREFIX.length) : undefined;

const getAssetId = (href: string): string | undefined => href.match(/\/download\/([0-9a-f-]+)\/?(?:#.*)?$/i)?.[1];

const getPdfMetadata = (href: string, text: string): { name: string; size: number } => {
  const metadata = href.match(/#plane-pdf=([^&]*)&size=(\d+)$/);
  return {
    name: metadata?.[1] ? decodeURIComponent(metadata[1]) : text.split(" · ")[0] || "document.pdf",
    size: metadata?.[2] ? Number(metadata[2]) : 0,
  };
};

const getPdfLinks = (doc: ProseMirrorNode): Map<string, TPdfLink> => {
  const links = new Map<string, TPdfLink>();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const mark = node.marks.find(
      (candidate) =>
        candidate.type.name === "link" &&
        String(candidate.attrs.class ?? "")
          .split(" ")
          .includes(PDF_ATTACHMENT_CLASS)
    );
    if (!mark) return;
    const href = String(mark.attrs.href ?? "");
    const assetId = getAssetId(href);
    if (!assetId) return;
    const metadata = getPdfMetadata(href, node.text);
    links.set(assetId, {
      from: pos,
      href: `#pdf-${assetId}`,
      id: assetId,
      name: metadata.name,
      size: metadata.size,
      src: assetId,
      to: pos + node.nodeSize,
      type: "pdf",
    });
  });
  return links;
};

const replacePendingLink = (
  editor: Editor,
  uploadId: string,
  attributes: { className: string; href: string; text: string }
) => {
  const linkType = editor.schema.marks.link;
  if (!linkType) return;
  const pendingHref = `${PDF_UPLOAD_PREFIX}${uploadId}`;
  let transaction = editor.state.tr;
  let didReplace = false;

  editor.state.doc.descendants((node, pos) => {
    if (didReplace || !node.isText) return;
    const mark = node.marks.find(
      (candidate) => candidate.type === linkType && String(candidate.attrs.href ?? "") === pendingHref
    );
    if (!mark) return;
    const updatedMark = linkType.create({
      ...mark.attrs,
      class: attributes.className,
      href: attributes.href,
      rel: "noopener noreferrer nofollow",
      target: "_blank",
    });
    transaction = transaction.replaceWith(pos, pos + node.nodeSize, editor.schema.text(attributes.text, [updatedMark]));
    didReplace = true;
  });

  if (didReplace) editor.view.dispatch(transaction);
};

const startUpload = async (
  editor: Editor,
  fileHandler: TFileHandler,
  storage: TPdfAttachmentStorage,
  uploadId: string
) => {
  const upload = storage.uploads.get(uploadId);
  if (!upload) return;

  replacePendingLink(editor, uploadId, {
    className: `${PDF_ATTACHMENT_CLASS} ${PDF_PENDING_CLASS}`,
    href: `${PDF_UPLOAD_PREFIX}${uploadId}`,
    text: `${upload.file.name} · ${formatFileSize(upload.file.size)}`,
  });

  try {
    const assetId = await fileHandler.upload(uploadId, upload.file);
    const downloadUrl = await fileHandler.getAssetDownloadSrc(assetId);
    const href = `${downloadUrl.split("#")[0]}#plane-pdf=${encodeURIComponent(upload.file.name)}&size=${upload.file.size}`;
    storage.newlyUploadedAssetIds.add(assetId);
    replacePendingLink(editor, uploadId, {
      className: PDF_ATTACHMENT_CLASS,
      href,
      text: `${upload.file.name} · ${formatFileSize(upload.file.size)}`,
    });
    storage.uploads.delete(uploadId);
    editor.commands.updateAssetsList?.({
      asset: {
        href: `#pdf-${assetId}`,
        id: assetId,
        name: upload.file.name,
        size: upload.file.size,
        src: assetId,
        type: "pdf",
      },
    });
  } catch (error) {
    console.error("Error uploading PDF attachment:", error);
    replacePendingLink(editor, uploadId, {
      className: `${PDF_ATTACHMENT_CLASS} ${PDF_ERROR_CLASS}`,
      href: `${PDF_UPLOAD_PREFIX}${uploadId}`,
      text: `${upload.file.name} · upload failed — click to retry`,
    });
  }
};

export const PdfAttachmentExtension = (fileHandler: TFileHandler) =>
  Extension.create<Record<string, never>, TPdfAttachmentStorage>({
    name: PDF_EXTENSION_NAME,

    addStorage() {
      return {
        deletedAssetIds: new Map<string, boolean>(),
        newlyUploadedAssetIds: new Set<string>(),
        uploads: new Map<string, TPdfUpload>(),
      };
    },

    addCommands() {
      return {
        insertPdfAttachment:
          ({ event: _event, file, pos }) =>
          ({ commands }) => {
            const isPdf = file.type === "application/pdf" && file.name.toLowerCase().endsWith(".pdf");
            if (!isPdf) {
              alert("Only PDF files are supported.");
              return false;
            }
            if (file.size <= 0 || file.size > fileHandler.validation.maxPdfFileSize) {
              alert(`PDF files must be smaller than ${formatFileSize(fileHandler.validation.maxPdfFileSize)}.`);
              return false;
            }

            const uploadId = crypto.randomUUID();
            this.storage.uploads.set(uploadId, { file });
            const content = {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: `${file.name} · ${formatFileSize(file.size)}`,
                  marks: [
                    {
                      type: "link",
                      attrs: {
                        class: `${PDF_ATTACHMENT_CLASS} ${PDF_PENDING_CLASS}`,
                        href: `${PDF_UPLOAD_PREFIX}${uploadId}`,
                        rel: "noopener noreferrer nofollow",
                        target: "_blank",
                      },
                    },
                  ],
                },
              ],
            };
            const inserted =
              typeof pos === "number" ? commands.insertContentAt(pos, content) : commands.insertContent(content);
            if (inserted) void startUpload(this.editor, fileHandler, this.storage, uploadId);
            return inserted;
          },
      };
    },

    onCreate() {
      getPdfLinks(this.editor.state.doc).forEach((asset, assetId) => {
        this.storage.deletedAssetIds.set(assetId, false);
        this.editor.commands.updateAssetsList?.({ asset });
      });

      this.storage.eventHandler = (event: Event) => {
        const detail = (event as CustomEvent<TPdfAttachmentPreviewEventDetail>).detail;
        if (detail.status === "error" && detail.uploadId) {
          void startUpload(this.editor, fileHandler, this.storage, detail.uploadId);
        }
      };
      window.addEventListener(PDF_ATTACHMENT_PREVIEW_EVENT, this.storage.eventHandler);
    },

    onDestroy() {
      if (this.storage.eventHandler) {
        window.removeEventListener(PDF_ATTACHMENT_PREVIEW_EVENT, this.storage.eventHandler);
      }
    },

    addProseMirrorPlugins() {
      const editor = this.editor;
      const storage = this.storage;
      return [
        new Plugin({
          key: new PluginKey("pdf-attachment-tracker"),
          appendTransaction: (transactions, oldState, newState) => {
            if (!transactions.some((transaction) => transaction.docChanged)) return null;
            const oldLinks = getPdfLinks(oldState.doc);
            const newLinks = getPdfLinks(newState.doc);

            oldLinks.forEach((asset, assetId) => {
              if (newLinks.has(assetId)) return;
              editor.commands.updateAssetsList?.({ idToRemove: assetId });
              if (transactions.some((transaction) => transaction.getMeta(CORE_EDITOR_META.SKIP_FILE_DELETION))) return;
              storage.deletedAssetIds.set(assetId, true);
              void fileHandler.delete(assetId).catch((error) => console.error("Error deleting PDF attachment:", error));
            });

            newLinks.forEach((asset, assetId) => {
              if (oldLinks.has(assetId)) return;
              editor.commands.updateAssetsList?.({ asset });
              if (storage.newlyUploadedAssetIds.delete(assetId)) {
                storage.deletedAssetIds.set(assetId, false);
                return;
              }
              if (storage.deletedAssetIds.get(assetId) === true) {
                void fileHandler
                  .restore(assetId)
                  .then(() => storage.deletedAssetIds.set(assetId, false))
                  .catch((error) => console.error("Error restoring PDF attachment:", error));
              } else {
                storage.deletedAssetIds.set(assetId, false);
              }
            });
            return null;
          },
          props: {
            decorations: (state) => {
              const decorations: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                if (!node.isText) return;
                const mark = node.marks.find(
                  (candidate) =>
                    candidate.type.name === "link" &&
                    String(candidate.attrs.class ?? "")
                      .split(" ")
                      .includes(PDF_PENDING_CLASS)
                );
                const uploadId = getUploadId(String(mark?.attrs.href ?? ""));
                if (!uploadId) return;
                const progress = editor.storage.utility?.assetsUploadStatus?.[uploadId];
                if (typeof progress !== "number") return;
                decorations.push(
                  Decoration.inline(pos, pos + node.nodeSize, {
                    "data-pdf-upload-progress": `${Math.round(progress)}%`,
                  })
                );
              });
              return DecorationSet.create(state.doc, decorations);
            },
          },
        }),
      ];
    },
  });
