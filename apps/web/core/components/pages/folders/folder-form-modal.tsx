/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { EPageAccess } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TPageFolder } from "@plane/types";
import { EModalPosition, EModalWidth, Input, ModalCore } from "@plane/ui";
import { EPageStoreType, usePageStore } from "@/plane-web/hooks/store";

type TFolderFormModalProps = {
  access?: EPageAccess;
  folder?: TPageFolder;
  isOpen: boolean;
  onClose: () => void;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  const data = error as { error?: string; name?: string[] };
  return data?.name?.[0] ?? data?.error ?? fallback;
};

export const FolderFormModal = observer(function FolderFormModal(props: TFolderFormModalProps) {
  const { access = EPageAccess.PUBLIC, folder, isOpen, onClose } = props;
  const { t } = useTranslation();
  const { createPageFolder, renamePageFolder } = usePageStore(EPageStoreType.PROJECT);
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) setName(folder?.name ?? "");
  }, [folder?.name, isOpen]);

  const handleClose = () => {
    setName("");
    setIsSubmitting(false);
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) return;

    setIsSubmitting(true);
    try {
      if (folder) await renamePageFolder(folder.id, normalizedName);
      else await createPageFolder({ name: normalizedName, access });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("page_folders.toast.success_title"),
        message: t(folder ? "page_folders.toast.renamed" : "page_folders.toast.created"),
      });
      handleClose();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("page_folders.toast.error_title"),
        message: getErrorMessage(error, t("page_folders.toast.save_failed")),
      });
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.TOP} width={EModalWidth.MD}>
      <form onSubmit={handleSubmit}>
        <div className="space-y-4 p-5">
          <h3 className="text-18 font-medium text-primary">
            {t(folder ? "page_folders.rename_folder" : "page_folders.new_folder")}
          </h3>
          <Input
            id="page-folder-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("page_folders.name_placeholder")}
            maxLength={255}
            className="w-full"
            required
          />
        </div>
        <div className="flex justify-end gap-2 border-t-[0.5px] border-subtle px-5 py-4">
          <Button variant="secondary" size="lg" type="button" onClick={handleClose}>
            {t("page_folders.cancel")}
          </Button>
          <Button variant="primary" size="lg" type="submit" loading={isSubmitting} disabled={!name.trim()}>
            {t(folder ? "page_folders.rename" : "page_folders.create")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
