/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import type { TPage, TPageFolder } from "@plane/types";
import { buildPageFolderListState, runOptimisticFolderMove } from "@/store/pages/page-folder.utils";

const PUBLIC_ACCESS = 0 as TPageFolder["access"];
const PRIVATE_ACCESS = 1 as TPageFolder["access"];

const folder = (id: string, name: string, access: TPageFolder["access"]): TPageFolder => ({
  id,
  name,
  access,
  owned_by: "owner",
  project: "project",
  workspace: "workspace",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  created_by: "owner",
  updated_by: null,
});

const page = (id: string, folderId: string | null, access: TPageFolder["access"], archived = false): TPage =>
  ({
    id,
    folder_id: folderId,
    name: id,
    access,
    archived_at: archived ? "2026-01-01" : null,
    project_ids: ["project"],
  }) as TPage;

const folders = [
  folder("folder-z", "Zulu", PUBLIC_ACCESS),
  folder("folder-a", "alpha", PUBLIC_ACCESS),
  folder("folder-private", "Private", PRIVATE_ACCESS),
];
const pages = [
  page("root-public", null, PUBLIC_ACCESS),
  page("nested-public", "folder-a", PUBLIC_ACCESS),
  page("root-private", null, PRIVATE_ACCESS),
  page("archived", "folder-z", PUBLIC_ACCESS, true),
];

describe("buildPageFolderListState", () => {
  it("orders public folders before unfiled pages at the root", () => {
    const result = buildPageFolderListState({
      activeFolderId: null,
      filteredPageIds: ["root-public", "nested-public"],
      folders,
      pages,
      pageType: "public",
      searchQuery: "",
    });
    expect(result).toEqual({ folderIds: ["folder-a", "folder-z"], pageIds: ["root-public"] });
  });

  it("keeps private and public tabs isolated", () => {
    const result = buildPageFolderListState({
      activeFolderId: null,
      filteredPageIds: ["root-private"],
      folders,
      pages,
      pageType: "private",
      searchQuery: "",
    });
    expect(result).toEqual({ folderIds: ["folder-private"], pageIds: ["root-private"] });
  });

  it("searches all matching pages at the root", () => {
    const result = buildPageFolderListState({
      activeFolderId: null,
      filteredPageIds: ["nested-public"],
      folders,
      pages,
      pageType: "public",
      searchQuery: "nested",
    });
    expect(result).toEqual({ folderIds: [], pageIds: ["nested-public"] });
  });

  it("restricts search to the active folder", () => {
    const result = buildPageFolderListState({
      activeFolderId: "folder-a",
      filteredPageIds: ["root-public", "nested-public"],
      folders,
      pages,
      pageType: "public",
      searchQuery: "page",
    });
    expect(result).toEqual({ folderIds: [], pageIds: ["nested-public"] });
  });

  it("only shows archived folders that contain matching archived pages", () => {
    const result = buildPageFolderListState({
      activeFolderId: null,
      filteredPageIds: ["archived"],
      folders,
      pages,
      pageType: "archived",
      searchQuery: "",
    });
    expect(result).toEqual({ folderIds: ["folder-z"], pageIds: [] });
  });
});

describe("runOptimisticFolderMove", () => {
  it("keeps the optimistic folder when the request succeeds", async () => {
    let folderId: string | null | undefined = "old";
    await runOptimisticFolderMove({
      previousFolderId: folderId,
      nextFolderId: "new",
      apply: (value) => {
        folderId = value;
      },
      request: vi.fn().mockResolvedValue(undefined),
    });
    expect(folderId).toBe("new");
  });

  it("rolls back the optimistic folder when the request fails", async () => {
    let folderId: string | null | undefined = "old";
    await expect(
      runOptimisticFolderMove({
        previousFolderId: folderId,
        nextFolderId: "new",
        apply: (value) => {
          folderId = value;
        },
        request: vi.fn().mockRejectedValue(new Error("network")),
      })
    ).rejects.toThrow("network");
    expect(folderId).toBe("old");
  });
});
