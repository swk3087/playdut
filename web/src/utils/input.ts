const PROJECT_URL_PATTERNS = [
  /^https?:\/\/playentry\.org\/project\/([a-zA-Z0-9_-]{1,64})\/?$/i,
  /^https?:\/\/playentry\.org\/ws\/([a-zA-Z0-9_-]{1,64})\/?$/i,
  /^([a-zA-Z0-9_-]{1,64})$/,
];

export function parseProjectInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("프로젝트 ID 또는 URL을 입력하세요.");
  }

  for (const pattern of PROJECT_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error("지원 형식: playentry project/ws URL 또는 프로젝트 ID");
}

export function toProjectUrl(id: string): string {
  return `https://playentry.org/project/${id}`;
}