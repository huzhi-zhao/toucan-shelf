import { Code, ConnectError } from "@connectrpc/connect";
import { Block, Button, List, ListItem, Navbar, NavbarBackLink, Page } from "konsta/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useImportPlanner } from "@/hooks/usePlannerQueries";
import SectionTitle from "../../components/SectionTitle";
import { COPY } from "../../copy";
import { navigateWithTransition, useBack, useBackLabel } from "../../lib/nav";
import { convertCalendarBlock, type ImportSummary } from "../../lib/planner";
import { MOBILE_ROUTES } from "../../routes";

const SUMMARY_ROWS: { key: keyof ImportSummary; label: string }[] = [
  { key: "habits", label: COPY.plannerImport.habits },
  { key: "checkIns", label: COPY.plannerImport.checkIns },
  { key: "activeTodos", label: COPY.plannerImport.activeTodos },
  { key: "doneTodos", label: COPY.plannerImport.doneTodos },
  { key: "cancelledTodos", label: COPY.plannerImport.cancelledTodos },
  { key: "notes", label: COPY.plannerImport.notes },
  { key: "skipped", label: COPY.plannerImport.skipped },
];

/**
 * The one-time backfill from a calendar block (requirement §2.6). The block is
 * parsed on the phone with the same parser the renderer uses, previewed, and
 * written in a single transaction; the server refuses a second import.
 */
export default function PlannerImportPage() {
  const back = useBack(MOBILE_ROUTES.PLAN_SETTINGS);
  const backText = useBackLabel() ?? COPY.plannerSettings.title;
  const navigate = useNavigate();
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const importPlanner = useImportPlanner();
  const converted = useMemo(() => (source.trim() ? convertCalendarBlock(source) : undefined), [source]);
  const total = converted
    ? converted.summary.habits + converted.summary.checkIns + converted.request.todos.length + converted.summary.notes
    : 0;

  const submit = () => {
    if (!converted || total === 0) return;
    setError("");
    importPlanner.mutate(converted.request, {
      onSuccess: () => navigateWithTransition(() => navigate(MOBILE_ROUTES.PLAN, { replace: true, flushSync: true }), "back"),
      onError: (err) =>
        setError(
          err instanceof ConnectError && err.code === Code.FailedPrecondition ? COPY.plannerImport.notEmpty : COPY.plannerImport.failed,
        ),
    });
  };

  return (
    <Page className="pb-safe">
      <Navbar title={COPY.plannerImport.title} left={<NavbarBackLink text={backText} showText onClick={back} />} />
      <Block className="!mt-4 !mb-2 text-[14px] text-black/55 dark:text-white/55">{COPY.plannerImport.hint}</Block>
      <div className="mx-4 rounded-xl bg-white dark:bg-[#1c1c1e] p-3">
        <textarea
          rows={10}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder={COPY.plannerImport.placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="w-full bg-transparent outline-none resize-none font-mono text-[13px]"
        />
      </div>

      {converted && (
        <>
          <SectionTitle>{COPY.plannerImport.preview}</SectionTitle>
          <List strongIos insetIos dividersIos className="!my-0">
            {SUMMARY_ROWS.filter((row) => row.key !== "skipped" || converted.summary.skipped > 0).map((row) => (
              <ListItem key={row.key} title={row.label} after={`${converted.summary[row.key]}`} />
            ))}
          </List>
        </>
      )}

      {error && <div className="mx-4 mt-4 text-[14px] text-red-500">{error}</div>}
      <Block className="!mt-6">
        <Button large rounded disabled={total === 0 || importPlanner.isPending} onClick={submit}>
          {importPlanner.isPending ? COPY.plannerImport.submitting : COPY.plannerImport.submit}
        </Button>
      </Block>
    </Page>
  );
}
