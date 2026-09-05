const ONEDRIVE_HOSTS = ["1drv.ms", "onedrive.live.com"];

export function buildDownloadUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter a tournament result link.");

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a complete link beginning with https://.");
  }

  if (url.protocol !== "https:") {
    throw new Error("For your security, tournament links must use HTTPS.");
  }

  const host = url.hostname.toLocaleLowerCase();
  const googleSheetMatch = host === "docs.google.com"
    ? url.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/)
    : null;
  if (googleSheetMatch) {
    return {
      url: `https://docs.google.com/spreadsheets/d/${googleSheetMatch[1]}/export?format=xlsx`,
      isOneDrive: false,
      isGoogleSheets: true,
    };
  }

  const isOneDrive = ONEDRIVE_HOSTS.includes(host) || host.endsWith(".sharepoint.com");
  if (isOneDrive) url.searchParams.set("download", "1");

  return { url: url.toString(), isOneDrive, isGoogleSheets: false };
}
