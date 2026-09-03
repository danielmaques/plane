/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// editors
export {
  CollaborativeDocumentEditorWithRef,
  DocumentEditorWithRef,
  LiteTextEditorWithRef,
  RichTextEditorWithRef,
} from "@/components/editors";

// constants
export * from "@/constants/common";
export { PDF_ATTACHMENT_CLASS, PDF_ATTACHMENT_PREVIEW_EVENT } from "@/constants/config";

// helpers
export * from "@/helpers/common";
export * from "@/helpers/yjs-utils";
export * from "@/plane-editor/helpers/markdown-import";
export * from "@/plane-editor/helpers/pdf-page-import";
export { PdfAttachmentExtension } from "@/plane-editor/extensions/pdf-attachment";

export { CORE_EXTENSIONS } from "@/constants/extension";
export { ADDITIONAL_EXTENSIONS } from "@/plane-editor/constants/extensions";

// types
export * from "@/types";

// additional exports
export { TrailingNode } from "./core/extensions/trailing-node";
