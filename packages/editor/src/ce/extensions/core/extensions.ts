/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Extensions } from "@tiptap/core";
// types
import type { IEditorProps } from "@/types";
// local imports
import { PdfAttachmentExtension } from "../pdf-attachment";

export type TCoreAdditionalExtensionsProps = Pick<
  IEditorProps,
  "disabledExtensions" | "flaggedExtensions" | "fileHandler" | "extendedEditorProps"
>;

export const CoreEditorAdditionalExtensions = (props: TCoreAdditionalExtensionsProps): Extensions => {
  const { fileHandler } = props;
  return [PdfAttachmentExtension(fileHandler)];
};
