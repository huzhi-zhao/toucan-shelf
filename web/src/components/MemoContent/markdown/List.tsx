import { Children, cloneElement, createContext, isValidElement, type ReactElement, type ReactNode, useContext } from "react";
import { markdownStyles } from "@/lib/markdownStyles";
import { cn } from "@/lib/utils";
import { resolveTaskStatus } from "@/utils/task-status";
import { Counter } from "../Counter";
import { TASK_LIST_CLASS, TASK_LIST_ITEM_CLASS } from "../constants";
import { NestedMarkdownRenderContext } from "../MarkdownRenderContext";
import { TaskStatusContext } from "../TaskStatusContext";
import type { ReactMarkdownProps } from "./types";

interface TaskListChildProps {
  children?: ReactNode;
  node?: {
    tagName?: string;
    properties?: {
      type?: unknown;
    };
  };
  type?: string;
}

const isCheckboxInput = (child: ReactNode): child is ReactElement<TaskListChildProps> => {
  return (
    isValidElement<TaskListChildProps>(child) && (child.props.type === "checkbox" || child.props.node?.properties?.type === "checkbox")
  );
};

const isParagraphElement = (child: ReactNode): child is ReactElement<TaskListChildProps> => {
  return isValidElement<TaskListChildProps>(child) && (child.type === "p" || child.props.node?.tagName === "p");
};

const splitTaskListItemChildren = (children: ReactNode) => {
  let checkbox: ReactNode;
  const content: ReactNode[] = [];

  Children.toArray(children).forEach((child) => {
    if (!checkbox && isCheckboxInput(child)) {
      checkbox = child;
      return;
    }

    if (!checkbox && isParagraphElement(child)) {
      const paragraphChildren: ReactNode[] = [];

      Children.toArray(child.props.children).forEach((paragraphChild) => {
        if (!checkbox && isCheckboxInput(paragraphChild)) {
          checkbox = paragraphChild;
          return;
        }
        paragraphChildren.push(paragraphChild);
      });

      if (checkbox) {
        if (paragraphChildren.length > 0) {
          content.push(cloneElement(child, undefined, ...paragraphChildren));
        }
        return;
      }
    }

    content.push(child);
  });

  return { checkbox, content };
};

interface ListProps extends React.HTMLAttributes<HTMLUListElement | HTMLOListElement>, ReactMarkdownProps {
  ordered?: boolean;
  children: React.ReactNode;
}

/**
 * How deeply the current bullet list is nested inside other bullet lists. Only
 * plain bullet lists count — an ordered or task list in between passes the depth
 * through untouched, since it draws its own markers anyway.
 */
const BulletDepthContext = createContext(0);

/**
 * Bullet glyph per nesting level, cycling like Notion's: filled disc, hollow
 * circle, filled square. `markdownStyles.bulletList` already carries `list-disc`
 * for level 0, so only the deeper levels need an override.
 */
const BULLET_MARKERS = ["list-disc", "list-[circle]", "list-[square]"] as const;

/**
 * List component for both regular and task lists (GFM)
 * Detects task lists via the "contains-task-list" class added by remark-gfm
 */
export const List = ({ ordered, children, className, node: _node, ...domProps }: ListProps) => {
  const Component = ordered ? "ol" : "ul";
  const isTaskList = className?.includes(TASK_LIST_CLASS);
  const bulletDepth = useContext(BulletDepthContext);
  const isBulletList = !ordered && !isTaskList;
  // Task list indentation is handled by task item grid columns; regular lists
  // use the shared token (padding + list style).
  const listClass = isTaskList ? "my-0 mb-2 list-outside list-none" : ordered ? markdownStyles.orderedList : markdownStyles.bulletList;

  const list = (
    <Component className={cn(listClass, isBulletList && BULLET_MARKERS[bulletDepth % BULLET_MARKERS.length], className)} {...domProps}>
      {children}
    </Component>
  );

  return isBulletList ? <BulletDepthContext.Provider value={bulletDepth + 1}>{list}</BulletDepthContext.Provider> : list;
};

interface ListItemProps extends React.LiHTMLAttributes<HTMLLIElement>, ReactMarkdownProps {
  children: React.ReactNode;
}

/**
 * List item component for both regular and task list items
 * Detects task items via the "task-list-item" class added by remark-gfm
 */
export const ListItem = ({ children, className, node: _node, ...domProps }: ListItemProps) => {
  const isTaskListItem = className?.includes(TASK_LIST_ITEM_CLASS);

  if (isTaskListItem) {
    const { checkbox, content } = splitTaskListItemChildren(children);
    const rawMarker = (domProps as Record<string, unknown>)["data-task-status"];
    const marker = typeof rawMarker === "string" ? rawMarker : undefined;
    const status = resolveTaskStatus(marker);

    return (
      <li className={cn(markdownStyles.taskListItem, className)} {...domProps}>
        <NestedMarkdownRenderContext>
          <TaskStatusContext.Provider value={status.marker}>{checkbox}</TaskStatusContext.Provider>
          <div
            className={cn(markdownStyles.taskItemContent, status.strikethrough && "line-through", status.muted && "text-muted-foreground")}
          >
            {content}
          </div>
        </NestedMarkdownRenderContext>
      </li>
    );
  }

  // `- [N] label`: remark-counter lifted the marker onto the item, so render a
  // clickable counter badge ahead of the content instead of a bullet.
  const rawCounter = (domProps as Record<string, unknown>)["data-counter"];
  if (typeof rawCounter === "string") {
    const rawIndex = (domProps as Record<string, unknown>)["data-counter-index"];
    const counterIndex = typeof rawIndex === "string" ? parseInt(rawIndex, 10) : NaN;

    return (
      <li className={cn(markdownStyles.listItem, "list-none flex items-baseline gap-1.5", className)} {...domProps}>
        <NestedMarkdownRenderContext>
          <Counter counterIndex={Number.isNaN(counterIndex) ? -1 : counterIndex}>{rawCounter}</Counter>
          <div className={markdownStyles.taskItemContent}>{children}</div>
        </NestedMarkdownRenderContext>
      </li>
    );
  }

  return (
    <li className={cn(markdownStyles.listItem, className)} {...domProps}>
      <NestedMarkdownRenderContext>{children}</NestedMarkdownRenderContext>
    </li>
  );
};
