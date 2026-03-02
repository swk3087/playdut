import type { EntryProject, ProjectApiResponse } from "../types/entry";

export async function fetchProjectById(id: string): Promise<EntryProject> {
  const res = await fetch(`/api/project/${encodeURIComponent(id)}`);
  const text = await res.text();

  let body: ProjectApiResponse | { error?: string };
  try {
    body = JSON.parse(text) as ProjectApiResponse;
  } catch {
    throw new Error(`서버 응답 파싱 실패 (status=${res.status})`);
  }

  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `프로젝트 로드 실패 (${res.status})`);
  }

  return (body as ProjectApiResponse).project;
}