const FALLBACK_PFP = "https://4thworld.army/images/pfps/pfp1.png";

export function getAvatarUrl(user) {
  const raw = user?.avatar_url?.trim();
  if (!raw) return FALLBACK_PFP;
  if (raw === "/images/pfps/default.png") return FALLBACK_PFP;
  return raw;
}
