/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TPdfAttachmentPreviewEventDetail = {
  assetId?: string;
  href: string;
  name: string;
  size: number;
  status: "error" | "pending" | "ready";
  uploadId?: string;
};
