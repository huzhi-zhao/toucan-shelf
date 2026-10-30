import dayjs from "dayjs";
import { Navbar, NavbarBackLink, Page, Preloader, Toast } from "konsta/react";
import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useHabits, usePlannerEntries } from "@/hooks/usePlannerQueries";
import CheckInDetail from "../../components/planner/CheckInDetail";
import { COPY } from "../../copy";
import { useBack, useBackLabel, useGo } from "../../lib/nav";
import { isDateEditable, localToday, PLANNER_MAX_UPDATE_DAYS_DEFAULT, PLANNER_MAX_UPDATE_DAYS_KEY } from "../../lib/planner";
import { usePref } from "../../lib/storage";
import { docRoute, habitNameFromUid, MOBILE_ROUTES, todoRoute } from "../../routes";

/**
 * A check-in made without a todo (requirement §2.4.4): who made it, its rating and note, and what was done. A
 * check-in that completed a habit todo lives on the todo's page, which shows the plan too, so every way here
 * for one of those lands there instead: one page per session, never a page behind a page.
 */
export default function CheckInPage() {
  const { uid = "", date = "" } = useParams();
  const habitName = habitNameFromUid(uid);
  const back = useBack(MOBILE_ROUTES.PLAN);
  const backText = useBackLabel() ?? COPY.planner.title;
  const go = useGo(COPY.checkIn.title);
  const { data: habits = [] } = useHabits();
  const { data: entries, isPending } = usePlannerEntries(date, date);
  const habit = habits.find((h) => h.name === habitName);
  const checkIn = entries?.checkIns.find((c) => c.habit === habitName && c.date === date);
  const [maxUpdateDays] = usePref(PLANNER_MAX_UPDATE_DAYS_KEY, PLANNER_MAX_UPDATE_DAYS_DEFAULT);
  const readOnly = !isDateEditable(date, localToday(), maxUpdateDays);

  const [toast, setToast] = useState("");
  const fail = () => {
    setToast(COPY.planner.failed);
    setTimeout(() => setToast(""), 2000);
  };

  if (checkIn?.todo) return <Navigate to={todoRoute(checkIn.todo)} replace state={{ backLabel: backText }} />;

  const title = `${habit?.title ?? ""} · ${date ? dayjs(date).format("M月D日") : ""}`;
  return (
    <Page className="pb-safe">
      <Navbar title={title} left={<NavbarBackLink text={backText} showText onClick={back} />} />
      {isPending ? (
        <div className="flex justify-center pt-16">
          <Preloader />
        </div>
      ) : !checkIn ? (
        <div className="px-8 pt-16 text-center text-black/45 dark:text-white/45">{COPY.checkIn.missing}</div>
      ) : (
        <>
          {readOnly && <p className="px-8 pt-3 text-[13px] text-black/45 dark:text-white/45">{COPY.planner.readonlyDay(maxUpdateDays)}</p>}
          <CheckInDetail checkIn={checkIn} readOnly={readOnly} onOpenDoc={(memo) => go(docRoute(memo))} onRemoved={back} onFail={fail} />
        </>
      )}
      <Toast position="center" opened={toast !== ""}>
        {toast}
      </Toast>
    </Page>
  );
}
