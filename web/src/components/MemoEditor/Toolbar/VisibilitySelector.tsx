import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import VisibilityIcon from "@/components/VisibilityIcon";
import { cn } from "@/lib/utils";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import type { VisibilitySelectorProps } from "../types";

const VisibilitySelector = (props: VisibilitySelectorProps) => {
  const { value, onChange, iconOnly } = props;
  const t = useTranslate();

  // PROTECTED no longer differs from PRIVATE: reading a document is decided by the
  // knowledge base it lives in, and PUBLIC is the only visibility that reaches past
  // that. So it is offered only to documents that already carry it, which keeps old
  // documents describing themselves honestly without inviting new ones into a choice
  // that does nothing.
  const visibilityOptions = [
    { value: Visibility.PRIVATE, label: t("memo.visibility.private"), description: t("memo.visibility.private-description") },
    ...(value === Visibility.PROTECTED
      ? [{ value: Visibility.PROTECTED, label: t("memo.visibility.protected"), description: t("memo.visibility.protected-description") }]
      : []),
    { value: Visibility.PUBLIC, label: t("memo.visibility.public"), description: t("memo.visibility.public-description") },
  ];

  const currentLabel = visibilityOptions.find((option) => option.value === value)?.label || "";

  return (
    <DropdownMenu onOpenChange={props.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          title={iconOnly ? currentLabel : undefined}
          className={cn(
            "inline-flex items-center rounded-md text-sm text-muted-foreground hover:bg-accent transition-colors",
            iconOnly ? "h-7 px-1" : "h-8 px-2",
          )}
        >
          <VisibilityIcon visibility={value} className={cn("opacity-60", !iconOnly && "mr-1.5")} />
          {!iconOnly && <span>{currentLabel}</span>}
          <ChevronDownIcon className={cn("w-4 h-4 opacity-60", !iconOnly && "ml-0.5")} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-xs">
        {visibilityOptions.map((option) => (
          <DropdownMenuItem key={option.value} className="cursor-pointer gap-2 items-start" onClick={() => onChange(option.value)}>
            <VisibilityIcon visibility={option.value} className="mt-0.5 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block">{option.label}</span>
              <span className="block text-xs text-muted-foreground whitespace-normal">{option.description}</span>
            </span>
            {value === option.value && <CheckIcon className="w-4 h-4 mt-0.5 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default VisibilitySelector;
