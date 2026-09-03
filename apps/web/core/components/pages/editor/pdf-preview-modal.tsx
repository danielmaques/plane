/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Download, ExternalLink, X } from "lucide-react";
// plane imports
import type { TPdfAttachmentPreviewEventDetail } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import { EModalWidth, ModalCore } from "@plane/ui";
import { getEditorAssetDownloadSrc, getEditorAssetSrc } from "@plane/utils";

type Props = {
  attachment: TPdfAttachmentPreviewEventDetail | null;
  onClose: () => void;
  projectId?: string;
  workspaceSlug: string;
};

const formatFileSize = (size: number): string => {
  if (!size) return "";
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export function PdfPreviewModal(props: Props) {
  const { attachment, onClose, projectId, workspaceSlug } = props;
  const { t } = useTranslation();
  const assetId = attachment?.assetId;
  const previewUrl = assetId
    ? getEditorAssetSrc({
        assetId,
        projectId,
        workspaceSlug,
      })
    : undefined;
  const downloadUrl = assetId
    ? getEditorAssetDownloadSrc({
        assetId,
        projectId,
        workspaceSlug,
      })
    : undefined;

  return (
    <ModalCore
      isOpen={Boolean(attachment && assetId)}
      handleClose={onClose}
      width={EModalWidth.VIIXL}
      className="flex h-[92vh] max-h-[92vh] flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between gap-4 border-b border-subtle px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-14 font-semibold text-primary">{attachment?.name}</h2>
          {attachment?.size ? <p className="text-11 text-secondary">{formatFileSize(attachment.size)}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1.5 rounded px-2 py-1.5 text-12 text-secondary hover:bg-layer-1 hover:text-primary"
          >
            <ExternalLink className="size-3.5" />
            {t("page_pdf.open_new_tab")}
          </a>
          <a
            href={downloadUrl}
            className="flex items-center gap-1.5 rounded px-2 py-1.5 text-12 text-secondary hover:bg-layer-1 hover:text-primary"
          >
            <Download className="size-3.5" />
            {t("page_pdf.download")}
          </a>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded text-secondary hover:bg-layer-1 hover:text-primary"
            aria-label={t("close")}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      {previewUrl ? (
        <iframe
          title="PDF attachment preview"
          src={previewUrl}
          className="min-h-0 flex-1 bg-white"
          sandbox="allow-downloads allow-same-origin"
        />
      ) : null}
    </ModalCore>
  );
}
