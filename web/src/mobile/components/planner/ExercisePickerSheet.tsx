import { List, ListItem, Preloader, Searchbar, Sheet } from "konsta/react";
import { CheckIcon } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useExerciseLibrary } from "@/hooks/usePlannerQueries";
import { type ExerciseGuide, groupGuides, guideMatches } from "@/utils/exerciseLibrary";
import { COPY } from "../../copy";
import DangerListButton from "../DangerListButton";

/**
 * Picks an exercise from the exercise library (requirement §2.4.4): the user's `kind: exercise` documents by
 * group, searchable by title and alias. With a guide already linked, it also offers to unlink it (`onPick(null)`).
 */
export default function ExercisePickerSheet({
  opened,
  picked,
  onClose,
  onPick,
}: {
  opened: boolean;
  /** The linked guide, `memos/{uid}`, or "". */
  picked: string;
  onClose: () => void;
  onPick: (guide: ExerciseGuide | null) => void;
}) {
  const creator = useCurrentUser()?.name ?? "";
  const { data: guides, isPending } = useExerciseLibrary(creator, opened);
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupGuides((guides ?? []).filter((guide) => guideMatches(guide, query))), [guides, query]);

  return (
    <Sheet className="pb-safe w-full h-[75vh] rounded-t-2xl flex flex-col" opened={opened} onBackdropClick={onClose}>
      <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
      <div className="px-2 pt-2">
        <Searchbar
          placeholder={COPY.checkIn.exercise.searchGuide}
          value={query}
          clearButton
          onInput={(event: FormEvent<HTMLInputElement>) => setQuery(event.currentTarget.value)}
          onClear={() => setQuery("")}
        />
      </div>
      <div className="flex-1 overflow-y-auto pb-4">
        {picked && (
          <List strongIos dividersIos className="!my-0">
            <DangerListButton onClick={() => onPick(null)}>{COPY.checkIn.exercise.unlinkGuide}</DangerListButton>
          </List>
        )}
        {isPending && opened ? (
          <div className="flex justify-center py-6">
            <Preloader />
          </div>
        ) : groups.length === 0 ? (
          <div className="px-6 py-10 text-center text-black/40 dark:text-white/40">
            {(guides ?? []).length === 0 ? COPY.checkIn.exercise.noGuides : COPY.checkIn.exercise.noMatch}
          </div>
        ) : (
          groups.map(({ group, guides }) => (
            <div key={group}>
              <div className="px-4 pt-4 pb-1.5 text-[13px] text-black/45 dark:text-white/45">
                {group || COPY.checkIn.exercise.ungrouped}
              </div>
              <List strongIos dividersIos className="!my-0">
                {guides.map((guide) => (
                  <ListItem
                    key={guide.name}
                    link
                    chevron={false}
                    title={guide.title}
                    text={guide.aliases.length > 0 ? <span className="whitespace-normal">{guide.aliases.join(" · ")}</span> : undefined}
                    after={guide.name === picked ? <CheckIcon className="h-5 w-5 text-primary" /> : undefined}
                    onClick={() => onPick(guide)}
                  />
                ))}
              </List>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}
