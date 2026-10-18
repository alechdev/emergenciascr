/** Fixed above the header; `--beta-banner-height` makes room for it (see `styles.css`). */
export function BetaBanner() {
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-53 h-(--beta-banner-height) border-b border-warning/40 bg-background text-xs text-warning-foreground">
      <div className="flex h-full items-center justify-center bg-warning/10 px-4">
        <p className="truncate">
          <strong className="font-medium">Sitio beta:</strong> datos de sync-v2.
          <span className="max-sm:hidden"> Pueden diferir del sitio principal.</span>
        </p>
      </div>
    </div>
  );
}
