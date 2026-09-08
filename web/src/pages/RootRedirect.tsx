import { useEffect } from "react";
import { useOpenLastDocument } from "@/hooks/useOpenLastDocument";

/**
 * Index route of the bare domain. Entering the site resumes where the user left off:
 * it restores the last-opened knowledge base and document (LAST_OPENED user setting),
 * falling back to the first workspace and finally to `/dashboard` when there is nothing
 * to restore. Redirects with `replace` so the empty root never lands in history.
 */
const RootRedirect = () => {
  const openLastDocument = useOpenLastDocument({ replace: true });

  useEffect(() => {
    void openLastDocument();
  }, [openLastDocument]);

  return null;
};

export default RootRedirect;
