/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
// constants
import { EPageAccess } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// plane types
import { Button } from "@plane/propel/button";
import { FolderPlus } from "lucide-react";
import { PageIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TPage } from "@plane/types";
// plane ui
import { Breadcrumbs, Header } from "@plane/ui";
// helpers
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { FolderFormModal } from "@/components/pages/folders";
// hooks
import { useProject } from "@/hooks/store/use-project";
// plane web imports
import { CommonProjectBreadcrumbs } from "@/plane-web/components/breadcrumbs/common";
import { EPageStoreType, usePageStore } from "@/plane-web/hooks/store";

export const PagesListHeader = observer(function PagesListHeader() {
  const { t } = useTranslation();
  // states
  const [isCreatingPage, setIsCreatingPage] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  // router
  const router = useRouter();
  const { workspaceSlug, projectId } = useParams();
  const searchParams = useSearchParams();
  const pageType = searchParams.get("type");
  const folderId = searchParams.get("folder");
  // store hooks
  const { currentProjectDetails, loader } = useProject();
  const { canCurrentUserCreatePage, createPage, getPageFolderById } = usePageStore(EPageStoreType.PROJECT);
  const selectedFolder = folderId ? getPageFolderById(folderId) : undefined;
  const activeFolder =
    selectedFolder &&
    (pageType === "archived" ||
      selectedFolder.access === (pageType === "private" ? EPageAccess.PRIVATE : EPageAccess.PUBLIC))
      ? selectedFolder
      : undefined;
  // handle page create
  const handleCreatePage = async () => {
    setIsCreatingPage(true);

    const payload: Partial<TPage> = {
      access: activeFolder?.access ?? (pageType === "private" ? EPageAccess.PRIVATE : EPageAccess.PUBLIC),
      folder_id: activeFolder?.id ?? null,
    };

    await createPage(payload)
      .then((res) => {
        const pageId = `/${workspaceSlug}/projects/${currentProjectDetails?.id}/pages/${res?.id}`;
        return router.push(pageId);
      })
      .catch((err) => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Error!",
          message: err?.data?.error || "Page could not be created. Please try again.",
        });
      })
      .finally(() => setIsCreatingPage(false));
  };

  return (
    <>
      <FolderFormModal
        access={pageType === "private" ? EPageAccess.PRIVATE : EPageAccess.PUBLIC}
        isOpen={isCreatingFolder}
        onClose={() => setIsCreatingFolder(false)}
      />
      <Header>
        <Header.LeftItem>
          <Breadcrumbs isLoading={loader === "init-loader"}>
            <CommonProjectBreadcrumbs workspaceSlug={workspaceSlug?.toString()} projectId={projectId?.toString()} />
            <Breadcrumbs.Item
              component={
                <BreadcrumbLink
                  label="Pages"
                  href={`/${workspaceSlug}/projects/${currentProjectDetails?.id}/pages?type=${pageType ?? "public"}`}
                  icon={<PageIcon className="h-4 w-4 text-tertiary" />}
                  isLast={!activeFolder}
                />
              }
              isLast={!activeFolder}
            />
            {activeFolder && (
              <Breadcrumbs.Item component={<BreadcrumbLink label={activeFolder.name} href="#" isLast />} isLast />
            )}
          </Breadcrumbs>
        </Header.LeftItem>
        {canCurrentUserCreatePage && pageType !== "archived" && (
          <Header.RightItem className="gap-2">
            {!activeFolder && (
              <Button variant="secondary" size="lg" onClick={() => setIsCreatingFolder(true)}>
                <FolderPlus className="mr-1 h-4 w-4" />
                {t("page_folders.new_folder")}
              </Button>
            )}
            <Button variant="primary" size="lg" onClick={handleCreatePage} loading={isCreatingPage}>
              {isCreatingPage ? t("page_folders.adding_page") : t("page_folders.add_page")}
            </Button>
          </Header.RightItem>
        )}
      </Header>
    </>
  );
});
