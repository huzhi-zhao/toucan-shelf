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
      <div className={cn("w-auto flex flex-row justify-start items-center text-foreground", collapsed ? "px-1" : "px-3")}>
        <UserAvatar className={cn("shrink-0", mini && "w-6 h-6")} avatarUrl={avatarUrl} />
        {!collapsed && (
          <span className={cn("font-medium text-foreground shrink truncate", mini ? "ml-1.5 text-xs" : "ml-2 text-lg")}>{title}</span>
        )}
      </div>
    </div>
  );
}

export default MemosLogo;
