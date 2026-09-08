import { useInstance } from "@/contexts/InstanceContext";
import { cn } from "@/lib/utils";
import UserAvatar from "./UserAvatar";

interface Props {
  className?: string;
  collapsed?: boolean;
  mini?: boolean;
}

function MemosLogo(props: Props) {
  const { collapsed, mini } = props;
  const { generalSetting: instanceGeneralSetting } = useInstance();
  const title = instanceGeneralSetting.customProfile?.title || "ToucanShelf";
  const avatarUrl = instanceGeneralSetting.customProfile?.logoUrl || "/full-logo.webp";

  return (
    <div className={cn("relative w-full h-auto shrink-0", props.className)}>
      <div className="flex w-auto flex-row items-center justify-start text-sidebar-foreground">
        <span className="shrink-0" data-sidebar-expand-trigger>
          <UserAvatar className={cn("border-sidebar-foreground/15 shadow-sm", mini ? "size-6" : "size-8")} avatarUrl={avatarUrl} />
        </span>
        {!collapsed && (
          <span className={cn("shrink truncate whitespace-nowrap font-semibold tracking-tight", mini ? "ml-2.5 text-xs" : "ml-3 text-sm")}>
            {title}
          </span>
        )}
      </div>
    </div>
  );
}

export default MemosLogo;
