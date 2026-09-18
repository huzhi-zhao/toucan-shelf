import { BookmarkIcon, FileTextIcon, PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useNewMemo } from "@/contexts/NewMemoContext";
import useNavigateTo from "@/hooks/useNavigateTo";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import type { User } from "@/types/proto/api/v1/user_service_pb";
import { useTranslate } from "@/utils/i18n";
import { convertVisibilityToString } from "@/utils/memo";
import MemoActionMenu from "../../MemoActionMenu";
import { ReactionSelector } from "../../MemoReactionListView";
import UserAvatar from "../../UserAvatar";
import VisibilityIcon from "../../VisibilityIcon";
import { useMemoActions } from "../hooks";
import { useMemoViewContext, useMemoViewDerived } from "../MemoViewContext";
import type { MemoHeaderProps } from "../types";

const MemoHeader: React.FC<MemoHeaderProps> = ({ showCreator, showVisibility, showPinned, compact, sidebarCollapsed, onToggleSidebar }) => {
  const t = useTranslate();
  const [reactionSelectorOpen, setReactionSelectorOpen] = useState(false);

  const { memo, creator, currentUser, parentPage, isArchived, readonly, openEditor } = useMemoViewContext();
  const { createTime, updateTime, displayTime: memoDisplayTime, isDisplayingUpdatedTime, relativeTimeFormat } = useMemoViewDerived();
  const { newMemoName } = useNewMemo();

  const navigateTo = useNavigateTo();
  const handleGotoMemoDetailPage = useCallback(() => {
    navigateTo(`/${memo.name}`, { state: { from: parentPage } });
  }, [memo.name, parentPage, navigateTo]);

  const { unpinMemo } = useMemoActions(memo);

  const timeValue = isArchived ? (
    memoDisplayTime?.toLocaleString(i18n.language)
  ) : (
    <relative-time datetime={memoDisplayTime?.toISOString()} lang={i18n.language} format={relativeTimeFormat} no-title=""></relative-time>
  );
  const displayTime = isDisplayingUpdatedTime ? (
    <>
      {t("common.last-updated-at")} {timeValue}
    </>
  ) : (
    timeValue
  );
  const timeTooltip = {
    createdAt: createTime ? `${t("common.created-at")}: ${createTime.toLocaleString(i18n.language)}` : undefined,
    updatedAt:
      updateTime && (!createTime || updateTime.getTime() !== createTime.getTime())
        ? `${t("common.last-updated-at")}: ${updateTime.toLocaleString(i18n.language)}`
        : undefined,
  };

  return (
    <div className="w-full flex flex-row justify-between items-center gap-2">
      <div className="w-auto max-w-[calc(100%-8rem)] grow flex flex-row justify-start items-center">
        {memo.title ? (
          <TitleDisplay
            title={memo.title}
            creator={showCreator ? creator : undefined}
            displayTime={displayTime}
            timeTooltip={timeTooltip}
            onGotoDetail={handleGotoMemoDetailPage}
          />
        ) : showCreator && creator ? (
          <CreatorDisplay creator={creator} displayTime={displayTime} timeTooltip={timeTooltip} onGotoDetail={handleGotoMemoDetailPage} />
        ) : (
          <TimeDisplay displayTime={displayTime} timeTooltip={timeTooltip} onGotoDetail={handleGotoMemoDetailPage} />
        )}
        {memo.name === newMemoName && (
          <span className="ml-2 shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium leading-none text-primary">
            {t("memo.new-badge")}
          </span>
        )}
      </div>

      <div className="flex flex-row justify-end items-center select-none shrink-0 gap-2">
        {currentUser && !isArchived && (
          <ReactionSelector
            className={cn("border-none w-auto h-auto", reactionSelectorOpen && "block!", "block sm:hidden sm:group-hover:block")}
            memo={memo}
            onOpenChange={setReactionSelectorOpen}
          />
        )}

        {showVisibility && memo.visibility !== Visibility.PRIVATE && (
          <Tooltip>
            <TooltipTrigger>
              <span className="flex justify-center items-center rounded-md hover:opacity-80">
                <VisibilityIcon visibility={memo.visibility} />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t(`memo.visibility.${convertVisibilityToString(memo.visibility).toLowerCase()}` as Parameters<typeof t>[0])}
            </TooltipContent>
          </Tooltip>
        )}

        {compact === false && onToggleSidebar && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onToggleSidebar} title={t("memo.toggle-sidebar")}>
            {sidebarCollapsed ? <PanelRightOpenIcon className="w-4 h-4" /> : <PanelRightCloseIcon className="w-4 h-4" />}
          </Button>
        )}

        {showPinned && memo.pinned && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-pointer">
                  <BookmarkIcon className="w-4 h-auto text-primary" onClick={unpinMemo} />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("common.unpin")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <MemoActionMenu memo={memo} readonly={readonly} onEdit={openEditor} />
      </div>
    </div>
  );
};

interface TitleDisplayProps {
  title: string;
  creator?: User;
  displayTime: React.ReactNode;
  timeTooltip: TimeTooltipContent;
  onGotoDetail: () => void;
}

const TitleDisplay: React.FC<TitleDisplayProps> = ({ title, creator, displayTime, timeTooltip, onGotoDetail }) => (
  <div className="w-full flex flex-row justify-between items-center gap-2 min-w-0">
    <div className="flex flex-row items-center gap-1.5 min-w-0">
      <FileTextIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
      <span className="font-medium truncate">{title}</span>
    </div>
    {creator && (
      <div className="flex flex-row items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
        <Link className="hover:opacity-80 rounded-md transition-colors" to={`/u/${encodeURIComponent(creator.username)}`} viewTransition>
          {creator.displayName || creator.username}
        </Link>
        <TimeTooltip content={timeTooltip}>
          <span className="cursor-pointer hover:opacity-80 transition-colors" onClick={onGotoDetail}>
            {displayTime}
          </span>
        </TimeTooltip>
      </div>
    )}
  </div>
);

interface CreatorDisplayProps {
  creator: User;
  displayTime: React.ReactNode;
  timeTooltip: TimeTooltipContent;
  onGotoDetail: () => void;
}

const CreatorDisplay: React.FC<CreatorDisplayProps> = ({ creator, displayTime, timeTooltip, onGotoDetail }) => (
  <div className="w-full flex flex-row justify-start items-center">
    <Link className="w-auto hover:opacity-80 rounded-md transition-colors" to={`/u/${encodeURIComponent(creator.username)}`} viewTransition>
      <UserAvatar className="mr-2 shrink-0" avatarUrl={creator.avatarUrl} />
    </Link>
    <div className="w-full flex flex-col justify-center items-start">
      <Link
        className="block leading-tight hover:opacity-80 rounded-md transition-colors truncate text-muted-foreground"
        to={`/u/${encodeURIComponent(creator.username)}`}
        viewTransition
      >
        {creator.displayName || creator.username}
      </Link>
      <TimeTooltip content={timeTooltip}>
        <span
          className="w-auto -mt-0.5 text-xs leading-tight text-muted-foreground select-none cursor-pointer hover:opacity-80 transition-colors text-left"
          onClick={onGotoDetail}
        >
          {displayTime}
        </span>
      </TimeTooltip>
    </div>
  </div>
);

interface TimeTooltipContent {
  createdAt?: string;
  updatedAt?: string;
}

const TimeTooltip = ({ children, content }: { children: React.ReactElement; content: TimeTooltipContent }) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent align="start" className="flex flex-col items-start gap-0.5 whitespace-nowrap text-left">
      {content.createdAt && <span>{content.createdAt}</span>}
      {content.updatedAt && <span>{content.updatedAt}</span>}
    </TooltipContent>
  </Tooltip>
);

interface TimeDisplayProps {
  displayTime: React.ReactNode;
  timeTooltip: TimeTooltipContent;
  onGotoDetail: () => void;
}

const TimeDisplay: React.FC<TimeDisplayProps> = ({ displayTime, timeTooltip, onGotoDetail }) => (
  <TimeTooltip content={timeTooltip}>
    <span
      className="w-auto text-sm leading-tight text-muted-foreground select-none cursor-pointer hover:text-foreground transition-colors text-left"
      onClick={onGotoDetail}
    >
      {displayTime}
    </span>
  </TimeTooltip>
);

export default MemoHeader;
