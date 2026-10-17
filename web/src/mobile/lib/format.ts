import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";

/** Calendar date for list rows and page headers: "2026-10-17". */
export const formatDate = (ts: Timestamp | undefined): string => (ts ? dayjs(timestampDate(ts)).format("YYYY-MM-DD") : "");
