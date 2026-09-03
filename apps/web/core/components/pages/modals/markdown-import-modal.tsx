/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ChangeEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileText, FolderOpen, LoaderCircle, XCircle } from "lucide-react";
// plane imports
import { EPageAccess } from "@plane/constants";
import {
  buildMarkdownImportManifest,
  convertJSONDocumentToAllFormats,
  replaceMarkdownLocalImages,
} from "@plane/editor";
import type { TMarkdownImportDocument, TMarkdownImportManifest } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { EFileAssetType } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { getEditorAssetSrc } from "@plane/utils";
// plane web imports
import { EPageStoreType, usePageStore } from "@/plane-web/hooks/store";
import { useFileSize } from "@/plane-web/hooks/use-file-size";
// services
import { FileService } from "@/services/file.service";
import { ProjectPageService } from "@/services/page";

type Props = {
  access: EPageAccess;
  folderId: string | null;
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  workspaceSlug: string;
};

type TImportState = {
  error?: string;
  progress: number;
  status: "error" | "pending" | "running" | "success";
};

const fileService = new FileService();
const pageService = new ProjectPageService();

export function MarkdownImportModal(props: Props) {
  const { access, folderId, isOpen, onClose, projectId, workspaceSlug } = props;
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [manifest, setManifest] = useState<TMarkdownImportManifest | null>(null);
  const [states, setStates] = useState<Record<string, TImportState>>({});
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const { maxFileSize } = useFileSize();
  const { createPage, removePage } = usePageStore(EPageStoreType.PROJECT);

  const counts = useMemo(
    () => ({
      error: Object.values(states).filter((item) => item.status === "error").length,
      success: Object.values(states).filter((item) => item.status === "success").length,
    }),
    [states]
  );

  const updateState = (path: string, update: Partial<TImportState>) =>
    setStates((current) => ({
      ...current,
      [path]: { ...(current[path] ?? { progress: 0, status: "pending" }), ...update },
    }));

  const reset = () => {
    setManifest(null);
    setStates({});
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleClose = () => {
    if (isImporting) return;
    reset();
    onClose();
  };

  const handleFolderSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    setIsValidating(true);
    try {
      const nextManifest = await buildMarkdownImportManifest(selectedFiles, {
        imageSizeLimit: maxFileSize,
        markdownSizeLimit: maxFileSize,
      });
      setManifest(nextManifest);
      const nextStates: Record<string, TImportState> = {};
      nextManifest.documents.forEach((document) => {
        nextStates[document.path] = { progress: 0, status: "pending" };
      });
      nextManifest.errors.forEach((error) => {
        nextStates[error.path || error.file.name] = { error: error.message, progress: 0, status: "error" };
      });
      setStates(nextStates);
    } finally {
      setIsValidating(false);
    }
  };

  const cleanupFailedPage = async (pageId: string, assetIds: string[]) => {
    await Promise.allSettled(
      assetIds.map((assetId) =>
        fileService.deleteNewAsset(
          getEditorAssetSrc({
            assetId,
            projectId,
            workspaceSlug,
          }) ?? ""
        )
      )
    );
    try {
      await pageService.archive(workspaceSlug, projectId, pageId);
      await removePage({ pageId });
    } catch (error) {
      console.error("Unable to remove an incomplete Markdown import:", error);
    }
  };

  const importDocument = async (document: TMarkdownImportDocument) => {
    let pageId: string | undefined;
    const assetIds: string[] = [];
    updateState(document.path, { error: undefined, progress: 2, status: "running" });
    try {
      const page = await createPage({
        access,
        folder_id: folderId,
        name: document.title,
      });
      pageId = page?.id;
      if (!pageId) throw new Error(t("page_markdown_import.errors.create_page"));
      updateState(document.path, { progress: 10 });

      const assetIdsByReference: Record<string, string> = {};
      for (const [index, image] of document.images.entries()) {
        // Upload in order so progress is deterministic and one Page cannot saturate the asset API.
        // eslint-disable-next-line no-await-in-loop
        const result = await fileService.uploadProjectAsset(
          workspaceSlug,
          projectId,
          {
            entity_identifier: pageId,
            entity_type: EFileAssetType.PAGE_DESCRIPTION,
          },
          image.file,
          (progressEvent) => {
            const uploadProgress = progressEvent.progress ?? 0;
            const total = Math.max(document.images.length, 1);
            updateState(document.path, { progress: Math.round(10 + ((index + uploadProgress) / total) * 70) });
          }
        );
        assetIds.push(result.asset_id);
        image.references.forEach((reference) => {
          assetIdsByReference[reference] = result.asset_id;
        });
      }

      updateState(document.path, { progress: 85 });
      const content = replaceMarkdownLocalImages(document.content, assetIdsByReference);
      const payload = convertJSONDocumentToAllFormats({ document_json: content, variant: "document" });
      await pageService.updateDescription(workspaceSlug, projectId, pageId, payload);
      updateState(document.path, { progress: 100, status: "success" });
    } catch (error) {
      if (pageId) await cleanupFailedPage(pageId, assetIds);
      updateState(document.path, {
        error: error instanceof Error ? error.message : t("page_markdown_import.errors.import_failed"),
        progress: 0,
        status: "error",
      });
    }
  };

  const handleImport = async () => {
    if (!manifest?.documents.length) return;
    setIsImporting(true);
    for (const document of manifest.documents) {
      // Import Pages in order to keep rollback isolated and avoid a burst of Page/asset writes.
      // eslint-disable-next-line no-await-in-loop
      if (states[document.path]?.status !== "success") await importDocument(document);
    }
    setIsImporting(false);
  };

  return (
    <ModalCore
      isOpen={isOpen}
      handleClose={handleClose}
      position={EModalPosition.CENTER}
      width={EModalWidth.XXXL}
      className="overflow-hidden"
    >
      <div className="border-b border-subtle px-5 py-4">
        <h2 className="text-16 font-semibold">{t("page_markdown_import.title")}</h2>
        <p className="mt-1 text-12 text-secondary">{t("page_markdown_import.description")}</p>
      </div>
      <div className="space-y-4 p-5">
        <input
          ref={inputRef}
          type="file"
          accept=".md,text/markdown,image/jpeg,image/png,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={handleFolderSelection}
          {...({ directory: "", webkitdirectory: "" } as Record<string, string>)}
        />
        {!manifest ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isValidating}
            className="flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-subtle bg-layer-1 p-6 text-center hover:border-strong"
          >
            <FolderOpen className="size-8 text-secondary" />
            <span className="text-13 font-medium">
              {isValidating ? t("page_markdown_import.validating") : t("page_markdown_import.choose_folder")}
            </span>
            <span className="text-11 text-secondary">{t("page_markdown_import.folder_help")}</span>
          </button>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {Object.entries(states).map(([path, state]) => (
              <div key={path} className="flex items-center gap-3 rounded border border-subtle px-3 py-2">
                {state.status === "success" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success-primary" />
                ) : state.status === "error" ? (
                  <XCircle className="size-4 shrink-0 text-danger-primary" />
                ) : state.status === "running" ? (
                  <LoaderCircle className="size-4 shrink-0 animate-spin text-accent-primary" />
                ) : (
                  <FileText className="size-4 shrink-0 text-secondary" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-12 font-medium">{path}</p>
                  {state.error ? <p className="truncate text-11 text-danger-primary">{state.error}</p> : null}
                  {state.status === "running" ? (
                    <div className="mt-1 h-1 overflow-hidden rounded bg-layer-2">
                      <div
                        className="h-full bg-accent-primary transition-all"
                        style={{ width: `${state.progress}%` }}
                      />
                    </div>
                  ) : null}
                </div>
                <span className="text-11 text-secondary">
                  {state.status === "running" ? `${state.progress}%` : t(`page_markdown_import.status.${state.status}`)}
                </span>
              </div>
            ))}
          </div>
        )}
        {manifest ? (
          <p className="text-11 text-secondary">
            {t("page_markdown_import.summary", {
              errors: counts.error,
              files: manifest.documents.length + manifest.errors.length,
              success: counts.success,
            })}
          </p>
        ) : null}
      </div>
      <div className="flex justify-between border-t border-subtle px-5 py-3">
        <Button variant="secondary" onClick={() => (manifest ? reset() : handleClose())} disabled={isImporting}>
          {manifest ? t("page_markdown_import.choose_another") : t("cancel")}
        </Button>
        {manifest ? (
          <Button
            variant="primary"
            onClick={handleImport}
            loading={isImporting}
            disabled={isImporting || manifest.documents.length === 0}
          >
            {isImporting ? t("page_markdown_import.importing") : t("page_markdown_import.import")}
          </Button>
        ) : null}
      </div>
    </ModalCore>
  );
}
