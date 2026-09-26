import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";

type Variant = "landing" | "notebook";

interface Props {
  variant: Variant;
}

const placeholder = "rounded-lg bg-muted/70 animate-pulse motion-reduce:animate-none";

const PageLoadingSkeleton = ({ variant }: Props) => {
  const t = useTranslate();

  return (
    <div className="flex min-h-svh w-full justify-center bg-background px-6 py-8 sm:px-10" role="status" aria-live="polite">
      <span className="sr-only">{t("common.loading")}</span>
      <div className={cn("w-full", variant === "notebook" ? "max-w-4xl" : "max-w-5xl")} aria-hidden="true">
        <div className={cn("mb-8 h-7 w-40", placeholder)} />
        <div className={cn("mb-5 h-4 w-56 max-w-full", placeholder)} />
        <div className={cn("mb-10 h-4 w-36", placeholder)} />
        <div className="space-y-5">
          <div className={cn("h-4 w-full", placeholder)} />
          <div className={cn("h-4 w-11/12", placeholder)} />
          <div className={cn("h-4 w-9/12", placeholder)} />
        </div>
        {variant === "landing" && (
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            <div className={cn("h-36", placeholder)} />
            <div className={cn("h-36", placeholder)} />
          </div>
        )}
      </div>
    </div>
  );
};

export default PageLoadingSkeleton;
