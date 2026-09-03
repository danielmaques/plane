/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TPageFolder } from "@plane/types";
import { AlertModalCore } from "@plane/ui";
import { EPageStoreType, usePageStore } from "@/plane-web/hooks/store";

type TDeleteFolderModalProps = {
  folder: TPageFolder;
  isOpen: boolean;
  onClose: () => void;
};

export const DeleteFolderModal = observer(function DeleteFolderModal(props: TDeleteFolderModalProps) {
  const { folder, isOpen, onClose } = props;
  const { t } = useTranslation();
  const { removePageFolder } = usePageStore(EPageStoreType.PROJECT);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      await removePageFolder(folder.id);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("page_folders.toast.success_title"),
        message: t("page_folders.toast.deleted"),
      });
      onClose();
    } catch (error) {
      const data = error as { error?: string };
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("page_folders.toast.error_title"),
        message: data?.error ?? t("page_folders.toast.delete_failed"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertModalCore
      handleClose={onClose}
      handleSubmit={handleDelete}
      isSubmitting={isSubmitting}
      isOpen={isOpen}
      title={t("page_folders.delete_folder")}
      content={
        <>
          {t("page_folders.delete_confirmation")} <span className="font-medium text-primary">{folder.name}</span>?{" "}
          {t("page_folders.delete_empty_only")}
        </>
      }
    />
  );
});
