/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { Download, FileText } from "lucide-react";
// plane imports
import { PDF_ATTACHMENT_PREVIEW_EVENT } from "@plane/editor";
import type { TEditorAsset, TPdfAttachmentPreviewEventDetail } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
// store
import type { TPageInstance } from "@/store/pages/base-page";

export type TAdditionalPageNavigationPaneAssetItemProps = {
  asset: TEditorAsset;
  assetSrc: string;
  assetDownloadSrc: string;
  page: TPageInstance;
};

const formatFileSize = (size: number): string => {
  if (!size) return "";
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export function AdditionalPageNavigationPaneAssetItem(props: TAdditionalPageNavigationPaneAssetItemProps) {
  const { asset, assetDownloadSrc, assetSrc } = props;
  const { t } = useTranslation();

  if (asset.type !== "pdf") return null;

  return (
    <div className="group/asset-item flex h-12 items-center gap-2 rounded-sm border border-subtle px-2 transition-colors hover:bg-layer-1">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => {
          const detail: TPdfAttachmentPreviewEventDetail = {
            assetId: asset.id,
            href: assetSrc,
            name: asset.name,
            size: asset.size,
            status: "ready",
          };
          window.dispatchEvent(new CustomEvent(PDF_ATTACHMENT_PREVIEW_EVENT, { detail }));
        }}
      >
        <span className="bg-red-500/10 text-red-600 grid size-8 shrink-0 place-items-center rounded">
          <FileText className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-13 font-medium">{asset.name}</span>
          <span className="block text-11 text-secondary">{formatFileSize(asset.size)}</span>
        </span>
      </button>
      <a
        href={assetDownloadSrc}
        target="_blank"
        rel="noreferrer noopener"
        className="pointer-events-none flex shrink-0 items-center gap-1 rounded-sm px-1 py-0.5 text-secondary opacity-0 transition-opacity group-hover/asset-item:pointer-events-auto group-hover/asset-item:opacity-100 hover:text-primary"
      >
        <Download className="size-3 shrink-0" />
        <span className="text-11 font-medium">{t("page_navigation_pane.tabs.assets.download_button")}</span>
      </a>
    </div>
  );
}
