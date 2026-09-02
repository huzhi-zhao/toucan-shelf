package attachmentmigrate

import (
	"fmt"
	"io"
	"sort"

	"github.com/usememos/memos/internal/storage/attachmentpath"
)

// WritePlanReport prints what the plan found. This is the whole output of a dry run, and the
// thing to read before deciding to apply anything.
func (p *Plan) WritePlanReport(w io.Writer) {
	inPlace, pending, skipped := p.Counts()
	fmt.Fprintf(w, "Filepath template: %s\n", p.Template)
	fmt.Fprintf(w, "Target: bucket %s at %s\n", p.TargetBucket, p.TargetEndpoint)
	fmt.Fprintf(w, "\nS3 attachments: %d total — %d already in place, %d to migrate, %d cannot be processed\n",
		len(p.Items), inPlace, pending, skipped)

	if pending > 0 {
		fmt.Fprintf(w, "\nTo migrate, by knowledge base:\n")
		byWorkspace := map[string][]*Item{}
		for _, item := range p.Items {
			if item.Status == StatusPending {
				byWorkspace[item.WorkspaceSlug] = append(byWorkspace[item.WorkspaceSlug], item)
			}
		}
		for _, slug := range sortedKeys(byWorkspace) {
			items := byWorkspace[slug]
			label := slug
			if slug == attachmentpath.UnassignedWorkspaceSlug {
				label = slug + "  (attachments not attached to any document)"
			}
			if items[0].SlugBackfilled {
				label += "  (slug backfilled — this knowledge base had none)"
			}
			fmt.Fprintf(w, "  %s: %d\n", label, len(items))
			for _, item := range items {
				fmt.Fprintf(w, "    #%d %s\n      %s\n      -> %s\n", item.AttachmentID, item.Filename, item.SourceKey, item.TargetKey)
			}
		}
	}

	if skipped > 0 {
		fmt.Fprintf(w, "\nCannot be processed:\n")
		for _, item := range p.Items {
			if item.Status == StatusSkipped {
				fmt.Fprintf(w, "  #%d %s: %s\n", item.AttachmentID, item.Filename, item.Reason)
			}
		}
	}
}

// WriteApplyReport prints what applying the plan actually did, and reports whether anything failed.
func (p *Plan) WriteApplyReport(w io.Writer) (failed int) {
	copied, reused := 0, 0
	for _, item := range p.Items {
		switch item.Outcome {
		case OutcomeCopied:
			copied++
		case OutcomeReused:
			reused++
		case OutcomeFailed:
			failed++
		}
	}
	fmt.Fprintf(w, "\nMigrated: %d copied, %d already at the target key, %d failed\n", copied, reused, failed)
	if failed > 0 {
		fmt.Fprintf(w, "\nFailures (left untouched, safe to re-run after fixing):\n")
		for _, item := range p.Items {
			if item.Outcome == OutcomeFailed {
				fmt.Fprintf(w, "  #%d %s: %s\n", item.AttachmentID, item.Filename, item.Error)
			}
		}
	}
	fmt.Fprintf(w, "\nThe source objects were not deleted. Clean them up yourself once you have\nverified the attachments still open — an S3 lifecycle rule, or deleting the old\nbucket/prefix by hand.\n")
	return failed
}

func sortedKeys(m map[string][]*Item) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
