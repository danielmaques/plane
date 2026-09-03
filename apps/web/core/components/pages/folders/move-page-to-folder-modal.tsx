/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CustomSelect, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { EPageStoreType, usePageStore } from "@/plane-web/hooks/store";
import type { TPageInstance } from "@/store/pages/base-page";

type TMovePageToFolderModalProps = {
  isOpen: boolean;
  onClose: () => void;
  page: TPageInstance;
};

export const MovePageToFolderModal = observer(function MovePageToFolderModal(props: TMovePageToFolderModalProps) {
  const { isOpen, onClose, page } = props;
  const { t } = useTranslation();
  const { workspaceSlug, projectId } = useParams();
  const { folderData, fetchPageFolders, movePageToFolder } = usePageStore(EPageStoreType.PROJECT);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(page.folder_id ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const folders = useMemo(
    () =>
      Object.values(folderData)
        .filter((folder) => folder.project === projectId?.toString() && folder.access === page.access)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [folderData, page.access, projectId]
  );
  const selectedFolder = selectedFolderId ? folderData[selectedFolderId] : undefined;

  useEffect(() => {
    if (!isOpen) return;

    setSelectedFolderId(page.folder_id ?? null);
    if (workspaceSlug && projectId) {
      void fetchPageFolders(workspaceSlug.toString(), projectId.toString()).catch(() => undefined);
    }
  }, [fetchPageFolders, isOpen, page.folder_id, projectId, workspaceSlug]);

  const handleSubmit = async () => {
    if (!page.id) return;
    setIsSubmitting(true);
    try {
      await movePageToFolder(page.id, selectedFolderId);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("page_folders.toast.success_title"),
        message: t("page_folders.toast.page_moved"),
      });
      onClose();
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("page_folders.toast.error_title"),
        message: t("page_folders.toast.move_failed"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.MD}>
      <div className="space-y-4 p-5">
        <h3 className="text-18 font-medium text-primary">{t("page_folders.move_page")}</h3>
        <CustomSelect
          value={selectedFolderId}
          onChange={(value: string | null) => setSelectedFolderId(value)}
          label={selectedFolder?.name ?? t("page_folders.root")}
          input
          className="w-full"
          buttonClassName="w-full"
        >
          <CustomSelect.Option value={null}>{t("page_folders.root")}</CustomSelect.Option>
          {folders.map((folder) => (
            <CustomSelect.Option key={folder.id} value={folder.id}>
              {folder.name}
            </CustomSelect.Option>
          ))}
        </CustomSelect>
      </div>
      <div className="flex justify-end gap-2 border-t-[0.5px] border-subtle px-5 py-4">
        <Button variant="secondary" size="lg" onClick={onClose}>
          {t("page_folders.cancel")}
        </Button>
        <Button variant="primary" size="lg" onClick={handleSubmit} loading={isSubmitting}>
          {t("page_folders.move")}
        </Button>
      </div>
    </ModalCore>
  );
});
